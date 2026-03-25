const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { Client } = require('minecraft-launcher-core');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

const launcher = new Client();
const WINDOWS_CLASSPATH_SEPARATOR = ';';
const MOJANG_VERSION_MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META = 'https://meta.fabricmc.net';
const FORGE_FILES_BASE = 'https://files.minecraftforge.net/net/minecraftforge/forge';
const FORGE_MAVEN_BASE = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const OPTIFINE_DOWNLOADS_URL = 'https://optifine.net/downloads';
const USER_AGENT = 'KaliLauncher/3.1.0';

const LAUNCHER_VERSION = '3.1.0';
const TBILISI_MC_VERSION = '1.20.1';
const TBILISI_FORGE_BUILD = '47.4.10';
const TBILISI_FORGE_VERSION_ID = `${TBILISI_MC_VERSION}-forge-${TBILISI_FORGE_BUILD}`;
const DEFAULT_LAUNCHER_CONFIG = {
    username: 'KaliPlayer',
    selectedProfile: 'tbilisi',
    selectedVersions: {
        tbilisi: '1.20.1',
        release: '1.21.11',
        forge: '1.20.1',
        fabric: '1.20.1',
        optifine: '1.20.1'
    },
    settings: {
        memoryMax: 6,
        memoryMin: 2,
        resolutionWidth: 1280,
        resolutionHeight: 720,
        fullscreen: false,
        closeBehavior: 'hide'
    }
};

function getLauncherConfigPath() {
    return path.join(app.getPath('userData'), 'launcher-config.json');
}

function getProfileRoot() {
    return path.join(app.getPath('userData'), '.kalilauncher', 'profile');
}

function getCustomSkinPath() {
    return path.join(getProfileRoot(), 'custom-skin.png');
}

function getProfileAssets() {
    const profileRoot = getProfileRoot();
    const customSkinPath = getCustomSkinPath();
    return {
        profileRoot,
        customSkinPath: fs.existsSync(customSkinPath) ? customSkinPath : null
    };
}

function deepMergeConfig(base, override) {
    const output = Array.isArray(base) ? [...base] : { ...base };
    for (const [key, value] of Object.entries(override || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
            output[key] = deepMergeConfig(base[key], value);
        } else {
            output[key] = value;
        }
    }
    return output;
}

function normalizeLauncherConfig(raw = {}) {
    const merged = deepMergeConfig(DEFAULT_LAUNCHER_CONFIG, raw || {});
    merged.username = String(merged.username || DEFAULT_LAUNCHER_CONFIG.username).trim() || DEFAULT_LAUNCHER_CONFIG.username;

    const settings = merged.settings || {};
    const maxMemory = Math.min(32, Math.max(2, Number(settings.memoryMax) || DEFAULT_LAUNCHER_CONFIG.settings.memoryMax));
    const minMemory = Math.min(maxMemory, Math.max(1, Number(settings.memoryMin) || DEFAULT_LAUNCHER_CONFIG.settings.memoryMin));
    merged.settings = {
        memoryMax: maxMemory,
        memoryMin: minMemory,
        resolutionWidth: Math.min(3840, Math.max(854, Number(settings.resolutionWidth) || DEFAULT_LAUNCHER_CONFIG.settings.resolutionWidth)),
        resolutionHeight: Math.min(2160, Math.max(480, Number(settings.resolutionHeight) || DEFAULT_LAUNCHER_CONFIG.settings.resolutionHeight)),
        fullscreen: Boolean(settings.fullscreen),
        closeBehavior: ['hide', 'minimize', 'stay'].includes(settings.closeBehavior) ? settings.closeBehavior : DEFAULT_LAUNCHER_CONFIG.settings.closeBehavior
    };

    merged.selectedProfile = ['tbilisi', 'release', 'forge', 'fabric', 'optifine'].includes(merged.selectedProfile) ? merged.selectedProfile : DEFAULT_LAUNCHER_CONFIG.selectedProfile;
    merged.selectedVersions = { ...DEFAULT_LAUNCHER_CONFIG.selectedVersions, ...(merged.selectedVersions || {}) };
    return merged;
}

function loadLauncherConfig() {
    const filePath = getLauncherConfigPath();
    try {
        if (!fs.existsSync(filePath)) {
            const normalized = normalizeLauncherConfig();
            fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
            return normalized;
        }
        return normalizeLauncherConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
        console.error('[Launcher] Failed to load config:', error);
        return normalizeLauncherConfig();
    }
}

function saveLauncherConfig(config) {
    const filePath = getLauncherConfigPath();
    const normalized = normalizeLauncherConfig(config);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
    return normalized;
}

function getLauncherSettings() {
    return loadLauncherConfig().settings;
}

function applyLaunchWindowBehavior() {
    const behavior = getLauncherSettings().closeBehavior;
    if (!win || win.isDestroyed()) return;
    if (behavior === 'stay') return;
    if (behavior === 'minimize') {
        win.minimize();
        return;
    }
    hideLauncherWindow();
}


let win;
let listenersBound = false;
let activeGameProcess = null;
let updaterInitialized = false;

function sendUpdaterStatus(type, message, pill = 'UPD') {
    const payload = { type, message, pill };
    console.log(`[Updater] ${message}`);
    if (win && !win.isDestroyed()) {
        win.webContents.send('updater-status', payload);
    }
}

function getUpdaterConfigPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'app-update.yml');
    }
    return path.join(app.getAppPath(), 'dev-app-update.yml');
}

function setupAutoUpdater() {
    if (updaterInitialized) return;
    updaterInitialized = true;

    const updateConfigPath = getUpdaterConfigPath();
    if (!fs.existsSync(updateConfigPath)) {
        console.log('[Updater] No update config found, auto-update disabled:', updateConfigPath);
        return;
    }

    if (!app.isPackaged) {
        autoUpdater.forceDevUpdateConfig = true;
    }

    autoUpdater.logger = log;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => sendUpdaterStatus('checking', 'Checking for updates...', 'UPD'));
    autoUpdater.on('update-available', (info) => sendUpdaterStatus('available', `Downloading update ${info?.version || ''}...`.trim(), 'UPD'));
    autoUpdater.on('update-not-available', () => sendUpdaterStatus('none', 'Launcher is up to date', 'OK'));
    autoUpdater.on('error', (error) => {
        console.error('[Updater] Error:', error);
        sendUpdaterStatus('error', 'Update check failed', 'ERR');
    });
    autoUpdater.on('download-progress', (progress) => {
        const percent = Math.round(progress.percent || 0);
        sendUpdaterStatus('progress', `Downloading update ${percent}%`, 'UPD');
    });
    autoUpdater.on('update-downloaded', async (info) => {
        sendUpdaterStatus('downloaded', `Update ${info?.version || ''} is ready`.trim(), 'NEW');
        const { response } = await dialog.showMessageBox({
            type: 'info',
            buttons: ['Install now', 'Later'],
            defaultId: 0,
            cancelId: 1,
            title: 'KaliLauncher update ready',
            message: `Version ${info?.version || 'new'} has been downloaded. Install now?`
        });
        if (response === 0) {
            setImmediate(() => autoUpdater.quitAndInstall());
        }
    });

    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((error) => {
            console.error('[Updater] Startup check failed:', error);
        });
    }, 3500);
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': '*/*'
            }
        }, (response) => {
            const status = response.statusCode || 0;

            if (status >= 300 && status < 400 && response.headers.location) {
                const redirectUrl = response.headers.location.startsWith('http')
                    ? response.headers.location
                    : new URL(response.headers.location, url).toString();
                response.resume();
                resolve(fetchUrl(redirectUrl));
                return;
            }

            if (status < 200 || status >= 300) {
                response.resume();
                reject(new Error(`Request failed (${status}) for ${url}`));
                return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
        });

        request.on('error', reject);
    });
}

async function fetchText(url) {
    const buffer = await fetchUrl(url);
    return buffer.toString('utf8');
}

async function downloadJson(url) {
    const raw = await fetchUrl(url);
    return JSON.parse(raw.toString('utf8'));
}

async function downloadFile(url, destinationPath) {
    const data = await fetchUrl(url);
    ensureDir(path.dirname(destinationPath));
    fs.writeFileSync(destinationPath, data);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sendStatus(message) {
    console.log(`[Launcher] ${message}`);
    if (win && !win.isDestroyed()) {
        win.webContents.send('download-progress', { message });
    }
}

function findJavaExecutableInRoots(roots, patterns = []) {
    for (const root of roots.filter(Boolean)) {
        if (!fs.existsSync(root)) continue;
        let entries = [];
        try {
            entries = fs.readdirSync(root, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
        } catch {
            continue;
        }

        for (const entryName of entries) {
            const lower = entryName.toLowerCase();
            if (patterns.length && !patterns.some((pattern) => pattern.test(lower))) continue;
            const javaPath = path.join(root, entryName, 'bin', 'java.exe');
            if (fs.existsSync(javaPath)) return javaPath;
        }
    }

    return null;
}

function getJavaExecutable(requiredMajor = null) {
    if (requiredMajor === 8) {
        const envCandidates = [process.env.JAVA8_HOME, process.env.JRE8_HOME]
            .filter(Boolean)
            .map((base) => path.join(base, 'bin', 'java.exe'))
            .filter((candidate) => fs.existsSync(candidate));

        if (envCandidates[0]) return envCandidates[0];

        const roots = [
            process.env['ProgramFiles'],
            process.env['ProgramFiles(x86)']
        ].filter(Boolean).flatMap((base) => [
            path.join(base, 'Java'),
            path.join(base, 'Eclipse Adoptium'),
            path.join(base, 'Temurin'),
            path.join(base, 'Amazon Corretto')
        ]);

        const found = findJavaExecutableInRoots(roots, [
            /jdk.*1\.8/, /jre.*1\.8/, /jdk-?8/, /jre-?8/, /temurin.*8/, /corretto.*8/
        ]);

        if (!found) {
            throw new Error('Forge 1.16.5 and below need Java 8. Install Java 8 first, then try again.');
        }

        return found;
    }

    return 'java';
}

function needsJava8ForForge(mcVersion) {
    return /^1\.(12|13|14|15|16)(\.|$)/.test(String(mcVersion));
}

function isFabricSupportedVersion(mcVersion) {
    return /^1\.(1[4-9]|20|21)(\.|$)/.test(String(mcVersion));
}

function hideLauncherWindow() {
    if (!win || win.isDestroyed()) return;
    win.hide();
}

function showLauncherWindow() {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function createWindow() {
    win = new BrowserWindow({
        width: 1120,
        height: 700,
        minWidth: 1120,
        minHeight: 700,
        resizable: false,
        backgroundColor: '#07111f',
        title: 'KaliLauncher',
        icon: path.join(__dirname, 'build', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    win.setMenuBarVisibility(false);
    win.loadFile('index.html');
    win.webContents.once('did-finish-load', () => setupAutoUpdater());
}

function bindLauncherEvents() {
    if (listenersBound) return;
    listenersBound = true;

    launcher.on('debug', (e) => {
        console.log('[MCLC][debug]', e);
        if (typeof e === 'string' && e.includes('Launching with arguments')) {
            applyLaunchWindowBehavior();
        }
    });
    launcher.on('data', (e) => console.log('[MCLC][data]', e));
    launcher.on('progress', (e) => {
        console.log('Progress:', e);
        if (win && !win.isDestroyed()) {
            win.webContents.send('download-progress', e);
        }
    });
    launcher.on('close', (code) => {
        console.log('Game closed with code:', code);
        showLauncherWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('game-closed');
        }
    });
    launcher.on('error', (err) => {
        console.error('[Launcher] Launch failed:', err);
        showLauncherWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('launch-error', err?.message || String(err));
        }
    });
}

function copyFolderSync(from, to) {
    if (!fs.existsSync(from)) return;
    ensureDir(to);
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name);
        if (entry.isDirectory()) copyFolderSync(src, dst);
        else fs.copyFileSync(src, dst);
    }
}

function copyPathIfExists(sourcePath, targetPath) {
    if (!fs.existsSync(sourcePath)) return;

    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
        copyFolderSync(sourcePath, targetPath);
        return;
    }

    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
}

function getOfficialMinecraftRoot() {
    return path.join(app.getPath('appData'), '.minecraft');
}

function getInstanceRoot() {
    return path.join(app.getPath('userData'), '.kalilauncher', 'instances', 'tbilisi-2077');
}

function sanitizeSegment(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

function prepareProfileInstance(profile, version) {
    const instanceRoot = path.join(app.getPath('userData'), '.kalilauncher', 'instances', `${sanitizeSegment(profile)}-${sanitizeSegment(version)}`);
    ensureDir(instanceRoot);
    for (const folder of ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves']) {
        ensureDir(path.join(instanceRoot, folder));
    }
    return instanceRoot;
}

function getCurrentProfileFolderPath(profile, version) {
    if (profile === 'tbilisi') return getInstanceRoot();
    if (profile === 'release') {
        return path.join(app.getPath('userData'), '.kalilauncher', 'vanilla', sanitizeSegment(version || '1.20.1'));
    }
    return path.join(app.getPath('userData'), '.kalilauncher', 'instances', `${sanitizeSegment(profile || 'release')}-${sanitizeSegment(version || '1.20.1')}`);
}

function prepareTbilisiInstance() {
    const instanceRoot = getInstanceRoot();
    const modpackRoot = path.join(__dirname, 'modpack_files');

    ensureDir(instanceRoot);
    if (fs.existsSync(modpackRoot)) {
        copyFolderSync(modpackRoot, instanceRoot);
    }

    for (const folder of ['mods', 'config', 'resourcepacks', 'shaderpacks']) {
        ensureDir(path.join(instanceRoot, folder));
    }

    return instanceRoot;
}

function exportPackDefaultsFromInstance(instanceRoot) {
    const modpackRoot = path.join(__dirname, 'modpack_files');
    const settingTargets = [
        'options.txt',
        'optionsof.txt',
        'optionsshaders.txt',
        'config',
        'defaultconfigs'
    ];

    for (const relativeTarget of settingTargets) {
        const sourcePath = path.join(instanceRoot, relativeTarget);
        const targetPath = path.join(modpackRoot, relativeTarget);
        copyPathIfExists(sourcePath, targetPath);
    }
}

function getBaseAuth(username) {
    return {
        access_token: '0',
        client_token: '0',
        uuid: '00000000-0000-0000-0000-000000000000',
        name: username,
        user_properties: '{}',
        meta: {
            type: 'mojang',
            xuid: '0',
            clientId: '0'
        }
    };
}

async function ensureOfficialVanillaVersion(minecraftRoot, versionId) {
    const versionDir = path.join(minecraftRoot, 'versions', versionId);
    const versionJsonPath = path.join(versionDir, `${versionId}.json`);
    let versionJson = null;

    if (fs.existsSync(versionJsonPath)) {
        versionJson = readJson(versionJsonPath);
    } else {
        sendStatus(`${versionId} metadata downloading...`);
        const manifest = await downloadJson(MOJANG_VERSION_MANIFEST_URL);
        const manifestEntry = (manifest.versions || []).find((entry) => entry.id === versionId);
        if (!manifestEntry?.url) {
            throw new Error(`Could not find official metadata for Minecraft ${versionId}.`);
        }

        versionJson = await downloadJson(manifestEntry.url);
        ensureDir(versionDir);
        fs.writeFileSync(versionJsonPath, JSON.stringify(versionJson, null, 2));
    }

    const clientJarUrl = versionJson?.downloads?.client?.url;
    const clientJarPath = path.join(versionDir, `${versionId}.jar`);
    if (clientJarUrl && !fs.existsSync(clientJarPath)) {
        sendStatus(`${versionId} client jar downloading...`);
        await downloadFile(clientJarUrl, clientJarPath);
    }

    const assetIndexId = versionJson?.assetIndex?.id;
    const assetIndexUrl = versionJson?.assetIndex?.url;
    if (assetIndexId && assetIndexUrl) {
        const assetIndexPath = path.join(minecraftRoot, 'assets', 'indexes', `${assetIndexId}.json`);
        if (!fs.existsSync(assetIndexPath)) {
            sendStatus(`${versionId} assets index downloading...`);
            await downloadFile(assetIndexUrl, assetIndexPath);
        }
    }
}

async function ensureParentVersionsReady(minecraftRoot, versionId) {
    const versionPath = path.join(minecraftRoot, 'versions', versionId, `${versionId}.json`);
    if (!fs.existsSync(versionPath)) {
        throw new Error(`Version JSON not found: ${versionPath}`);
    }

    const current = readJson(versionPath);
    if (!current.inheritsFrom) return;

    await ensureOfficialVanillaVersion(minecraftRoot, current.inheritsFrom);
    await ensureParentVersionsReady(minecraftRoot, current.inheritsFrom);
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isOfficialForgeVersionId(versionId, mcVersion) {
    const safeMc = escapeRegex(String(mcVersion));
    return new RegExp(`^(?:${safeMc}-forge-[a-z0-9._-]+|forge-${safeMc}(?:-[a-z0-9._-]+)?)$`, 'i').test(String(versionId || ''));
}

function isOfficialFabricVersionId(versionId, mcVersion) {
    const safeMc = escapeRegex(String(mcVersion));
    return new RegExp(`^fabric-loader-[a-z0-9._-]+-${safeMc}$`, 'i').test(String(versionId || ''));
}

function isOfficialOptiFineVersionId(versionId, mcVersion) {
    const safeMc = escapeRegex(String(mcVersion));
    return new RegExp(`^${safeMc}-OptiFine_HD_[A-Z0-9_]+$`, 'i').test(String(versionId || ''));
}

function findInstalledVersionMatch(minecraftRoot, loader, mcVersion, options = {}) {
    const versionsDir = path.join(minecraftRoot, 'versions');
    if (!fs.existsSync(versionsDir)) return null;

    const strictOfficial = Boolean(options.strictOfficial);

    const candidates = fs.readdirSync(versionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((versionId) => {
            const lower = versionId.toLowerCase();
            if (!lower.includes(String(mcVersion).toLowerCase())) return false;

            if (loader === 'forge') {
                if (!lower.includes('forge')) return false;
                if (strictOfficial && !isOfficialForgeVersionId(versionId, mcVersion)) return false;
                return true;
            }
            if (loader === 'fabric') {
                if (!lower.includes('fabric')) return false;
                if (strictOfficial && !isOfficialFabricVersionId(versionId, mcVersion)) return false;
                return true;
            }
            if (loader === 'optifine') {
                if (!lower.includes('optifine')) return false;
                if (strictOfficial && !isOfficialOptiFineVersionId(versionId, mcVersion)) return false;
                return true;
            }
            return false;
        })
        .filter((versionId) => fs.existsSync(path.join(versionsDir, versionId, `${versionId}.json`)));

    const scoreCandidate = (versionId) => {
        const lower = versionId.toLowerCase();
        let score = 0;
        if (lower.startsWith(String(mcVersion).toLowerCase())) score += 40;
        if (lower.includes(String(mcVersion).toLowerCase())) score += 100;
        if (loader === 'forge' && lower.includes('forge')) score += 60;
        if (loader === 'fabric' && lower.includes('fabric')) score += 60;
        if (loader === 'optifine' && lower.includes('optifine')) score += 60;
        if (loader === 'forge' && isOfficialForgeVersionId(versionId, mcVersion)) score += 200;
        if (loader === 'fabric' && isOfficialFabricVersionId(versionId, mcVersion)) score += 200;
        if (loader === 'optifine' && isOfficialOptiFineVersionId(versionId, mcVersion)) score += 120;
        if (loader === 'fabric' && lower.startsWith('fabric-loader')) score += 20;
        if (loader === 'optifine' && lower.includes('hd_u')) score += 10;
        return score;
    };

    candidates.sort((left, right) => {
        const scoreDiff = scoreCandidate(right) - scoreCandidate(left);
        if (scoreDiff !== 0) return scoreDiff;
        return right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' });
    });

    return candidates[0] || null;
}

function getInstalledForgeVersion(minecraftRoot) {
    return fs.existsSync(path.join(minecraftRoot, 'versions', TBILISI_FORGE_VERSION_ID, `${TBILISI_FORGE_VERSION_ID}.json`)) ? TBILISI_FORGE_VERSION_ID : findInstalledVersionMatch(minecraftRoot, 'forge', TBILISI_MC_VERSION, { strictOfficial: true });
}

function dedupeLibraries(libraries) {
    const seen = new Set();
    const result = [];

    for (const lib of libraries || []) {
        if (!lib) continue;
        const key = lib.name || JSON.stringify(lib.downloads || lib);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(lib);
    }

    return result;
}

function mergeVersionJson(parentJson, childJson) {
    const parentArgs = parentJson.arguments || { game: [], jvm: [] };
    const childArgs = childJson.arguments || { game: [], jvm: [] };

    return {
        ...parentJson,
        ...childJson,
        libraries: dedupeLibraries([...(parentJson.libraries || []), ...(childJson.libraries || [])]),
        arguments: {
            game: [...(childArgs.game || []), ...(parentArgs.game || [])],
            jvm: [...(parentArgs.jvm || []), ...(childArgs.jvm || [])]
        },
        logging: childJson.logging || parentJson.logging,
        assetIndex: childJson.assetIndex || parentJson.assetIndex,
        downloads: childJson.downloads || parentJson.downloads,
        javaVersion: childJson.javaVersion || parentJson.javaVersion,
        mainClass: childJson.mainClass || parentJson.mainClass,
        assets: childJson.assets || parentJson.assets
    };
}

function loadMergedVersionJson(minecraftRoot, versionId) {
    const versionPath = path.join(minecraftRoot, 'versions', versionId, `${versionId}.json`);
    if (!fs.existsSync(versionPath)) {
        throw new Error(`Version JSON not found: ${versionPath}`);
    }

    const current = readJson(versionPath);
    if (!current.inheritsFrom) return current;

    const parent = loadMergedVersionJson(minecraftRoot, current.inheritsFrom);
    return mergeVersionJson(parent, current);
}

function isUsableModernForgeVersion(minecraftRoot, versionId) {
    try {
        const merged = loadMergedVersionJson(minecraftRoot, versionId);
        const jvmArgs = merged?.arguments?.jvm || [];
        const gameArgs = merged?.arguments?.game || [];
        const libraries = merged?.libraries || [];
        return String(merged?.mainClass || '').includes('cpw.mods.bootstraplauncher.BootstrapLauncher')
            && Array.isArray(jvmArgs) && jvmArgs.length > 8
            && Array.isArray(gameArgs) && gameArgs.length > 8
            && Array.isArray(libraries) && libraries.some((lib) => String(lib?.name || '').includes('bootstraplauncher'));
    } catch {
        return false;
    }
}

function isWindowsRuleMatch(ruleOs) {
    if (!ruleOs) return true;
    if (ruleOs.name && ruleOs.name !== 'windows') return false;
    return true;
}

function featureRuleMatches(features = {}) {
    const featureDefaults = {
        is_demo_user: false,
        has_custom_resolution: true,
        has_quick_plays_support: false,
        is_quick_play_singleplayer: false,
        is_quick_play_multiplayer: false,
        is_quick_play_realms: false
    };

    for (const [key, expected] of Object.entries(features || {})) {
        const actual = featureDefaults[key] !== undefined ? featureDefaults[key] : false;
        if (actual !== expected) return false;
    }

    return true;
}

function rulesAllow(rules) {
    if (!rules || !rules.length) return true;

    let allowed = false;
    for (const rule of rules) {
        const matchesOs = isWindowsRuleMatch(rule.os);
        const matchesFeatures = featureRuleMatches(rule.features);
        if (!matchesOs || !matchesFeatures) continue;
        allowed = rule.action === 'allow';
    }
    return allowed;
}

function normalizeArgValues(entry) {
    if (typeof entry === 'string') return [entry];
    if (!entry || !rulesAllow(entry.rules)) return [];
    if (Array.isArray(entry.value)) return entry.value;
    if (typeof entry.value === 'string') return [entry.value];
    return [];
}

function collectVersionJarPaths(minecraftRoot, versionId, seen = new Set(), includeInherited = true) {
    if (!versionId || seen.has(versionId)) return [];
    seen.add(versionId);

    const versionDir = path.join(minecraftRoot, 'versions', versionId);
    const versionJsonPath = path.join(versionDir, `${versionId}.json`);
    const versionJarPath = path.join(versionDir, `${versionId}.jar`);
    const result = [];

    if (fs.existsSync(versionJarPath)) {
        result.push(versionJarPath);
    }

    if (fs.existsSync(versionJsonPath)) {
        try {
            const versionJson = readJson(versionJsonPath);
            if (versionJson.inheritsFrom && includeInherited) {
                result.push(...collectVersionJarPaths(minecraftRoot, versionJson.inheritsFrom, seen, includeInherited));
            }
        } catch {
            // ignore broken json
        }
    }

    return result;
}

function resolveLibraryPaths(minecraftRoot, mergedJson, versionId, includeInheritedVersionJars = true) {
    const paths = [];

    for (const lib of mergedJson.libraries || []) {
        if (!rulesAllow(lib.rules)) continue;

        if (lib.downloads?.artifact?.path) {
            paths.push(path.join(minecraftRoot, 'libraries', lib.downloads.artifact.path));
        }

        if (lib.downloads?.classifiers) {
            for (const classifier of Object.values(lib.downloads.classifiers)) {
                if (classifier?.path) {
                    paths.push(path.join(minecraftRoot, 'libraries', classifier.path));
                }
            }
        }
    }

    paths.push(...collectVersionJarPaths(minecraftRoot, versionId, new Set(), includeInheritedVersionJars));
    return [...new Set(paths.filter(fs.existsSync))];
}

function substitutePlaceholders(value, context) {
    return value.replace(/\$\{([^}]+)\}/g, (_match, key) => {
        const replacement = context[key];
        return replacement !== undefined ? String(replacement) : _match;
    });
}

function buildLaunchArgs(mergedJson, versionId, minecraftRoot, instanceRoot, username, launchSettings = {}) {
    const isModernForge = String(mergedJson.mainClass || '').includes('cpw.mods.bootstraplauncher.BootstrapLauncher');
    const classpath = resolveLibraryPaths(minecraftRoot, mergedJson, versionId, !isModernForge).join(WINDOWS_CLASSPATH_SEPARATOR);
    const assetIndexName = mergedJson.assetIndex?.id || mergedJson.assets || versionId;
    const nativesDirectory = isModernForge ? minecraftRoot : path.join(minecraftRoot, 'natives', versionId);

    const context = {
        natives_directory: nativesDirectory,
        launcher_name: 'KaliLauncher',
        launcher_version: LAUNCHER_VERSION,
        classpath,
        classpath_separator: WINDOWS_CLASSPATH_SEPARATOR,
        library_directory: path.join(minecraftRoot, 'libraries'),
        auth_player_name: username,
        version_name: versionId,
        game_directory: instanceRoot,
        assets_root: path.join(minecraftRoot, 'assets'),
        assets_index_name: assetIndexName,
        auth_uuid: '00000000-0000-0000-0000-000000000000',
        auth_access_token: '0',
        auth_session: '0',
        auth_xuid: '0',
        clientid: '0',
        user_type: 'mojang',
        version_type: 'release',
        user_properties: '{}',
        resolution_width: String(launchSettings.resolutionWidth || 1280),
        resolution_height: String(launchSettings.resolutionHeight || 720)
    };

    const jvmArgs = [];
    for (const entry of mergedJson.arguments?.jvm || []) {
        for (const value of normalizeArgValues(entry)) {
            const resolved = substitutePlaceholders(value, context);
            if (!resolved.includes('${')) jvmArgs.push(resolved);
        }
    }

    if (!jvmArgs.some((arg) => arg.includes('java.lang.invoke'))) {
        jvmArgs.push('--add-opens=java.base/java.lang.invoke=ALL-UNNAMED');
    }

    const filteredJvmArgs = jvmArgs.filter((arg) => !/^\-Xm[xs]/i.test(arg));
    filteredJvmArgs.push(`-Xmx${Math.max(2, Number(launchSettings.memoryMax) || 6)}G`);
    filteredJvmArgs.push(`-Xms${Math.max(1, Number(launchSettings.memoryMin) || 2)}G`);

    const gameArgs = [];
    for (const entry of mergedJson.arguments?.game || []) {
        for (const value of normalizeArgValues(entry)) {
            const resolved = substitutePlaceholders(value, context);
            if (!resolved.includes('${')) gameArgs.push(resolved);
        }
    }

    if (launchSettings.fullscreen && !gameArgs.includes('--fullscreen')) {
        gameArgs.push('--fullscreen');
    }

    return {
        mainClass: mergedJson.mainClass,
        jvmArgs: filteredJvmArgs,
        gameArgs
    };
}

function runCommandCapture(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            windowsHide: true,
            detached: false
        });

        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            console.log(`[${options.logPrefix || 'CMD'}][stdout]`, text);
        });
        child.stderr?.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            console.log(`[${options.logPrefix || 'CMD'}][stderr]`, text);
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

async function getLatestFabricLoaderVersion(mcVersion) {
    if (!isFabricSupportedVersion(mcVersion)) {
        throw new Error(`Fabric officially supports release 1.14 and above. ${mcVersion} is not supported.`);
    }

    const versions = await downloadJson(`${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mcVersion)}`);
    const chosen = (versions || []).find((entry) => entry?.loader?.stable) || (versions || [])[0];
    const loaderVersion = chosen?.loader?.version;
    if (!loaderVersion) {
        throw new Error(`No Fabric loader version was found for ${mcVersion}.`);
    }
    return loaderVersion;
}

async function ensureFabricVersionInstalled(minecraftRoot, mcVersion) {
    const existing = findInstalledVersionMatch(minecraftRoot, 'fabric', mcVersion, { strictOfficial: true });
    if (existing) return existing;

    if (!isFabricSupportedVersion(mcVersion)) {
        throw new Error(`Fabric officially supports release 1.14 and above. ${mcVersion} is not supported.`);
    }

    sendStatus(`Preparing Fabric ${mcVersion}...`);
    await ensureOfficialVanillaVersion(minecraftRoot, mcVersion);

    const loaderVersion = await getLatestFabricLoaderVersion(mcVersion);
    const profileJson = await downloadJson(`${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`);
    const versionId = profileJson?.id || `fabric-loader-${loaderVersion}-${mcVersion}`;
    const versionDir = path.join(minecraftRoot, 'versions', versionId);
    const versionJsonPath = path.join(versionDir, `${versionId}.json`);

    ensureDir(versionDir);
    fs.writeFileSync(versionJsonPath, JSON.stringify(profileJson, null, 2));
    return versionId;
}

async function getForgeInstallerUrl(mcVersion) {
    const pageHtml = await fetchText(`${FORGE_FILES_BASE}/index_${encodeURIComponent(mcVersion)}.html`);
    const escapedMc = mcVersion.replace(/\./g, '\\.');
    const regex = new RegExp(`https://maven\\.minecraftforge\\.net/net/minecraftforge/forge/(${escapedMc}-[^/]+)/forge-\\1-installer\\.jar`, 'ig');
    const matches = [];
    let match;
    while ((match = regex.exec(pageHtml)) !== null) {
        matches.push(match[0]);
    }

    if (!matches.length) {
        throw new Error(`Could not find an official Forge installer link for ${mcVersion}.`);
    }

    return matches[0];
}

async function ensureForgeVersionInstalled(minecraftRoot, mcVersion, options = {}) {
    const preferredVersionId = options.preferredVersionId || null;
    const preferredBuild = options.preferredBuild || null;

    if (preferredVersionId && fs.existsSync(path.join(minecraftRoot, 'versions', preferredVersionId, `${preferredVersionId}.json`))) {
        if (!preferredBuild || !preferredBuild.includes('47.') || isUsableModernForgeVersion(minecraftRoot, preferredVersionId)) {
            return preferredVersionId;
        }
    }

    const existing = findInstalledVersionMatch(minecraftRoot, 'forge', mcVersion, { strictOfficial: true });
    if (existing) {
        const modern = /forge-4[7-9]|forge-5\d|forge-6\d/i.test(existing);
        if (!modern || isUsableModernForgeVersion(minecraftRoot, existing)) {
            return existing;
        }
    }

    sendStatus(`Preparing Forge ${mcVersion}...`);
    await ensureOfficialVanillaVersion(minecraftRoot, mcVersion);

    if (preferredVersionId) {
        const preferredDir = path.join(minecraftRoot, 'versions', preferredVersionId);
        if (fs.existsSync(preferredDir) && preferredBuild && preferredBuild.includes('47.') && !isUsableModernForgeVersion(minecraftRoot, preferredVersionId)) {
            fs.rmSync(preferredDir, { recursive: true, force: true });
        }
    }

    const installerUrl = preferredBuild
        ? `${FORGE_MAVEN_BASE}/${preferredBuild}/forge-${preferredBuild}-installer.jar`
        : await getForgeInstallerUrl(mcVersion);

    const installerFileName = installerUrl.split('/').pop() || `forge-${preferredBuild || mcVersion}-installer.jar`;
    const installerPath = path.join(app.getPath('temp'), 'kalilauncher-installers', installerFileName);
    if (!fs.existsSync(installerPath)) {
        sendStatus(`Downloading Forge ${mcVersion} installer...`);
        await downloadFile(installerUrl, installerPath);
    }

    const javaBin = needsJava8ForForge(mcVersion) ? getJavaExecutable(8) : getJavaExecutable();

    sendStatus(`Installing Forge ${mcVersion}...`);
    let installResult = await runCommandCapture(javaBin, ['-jar', installerPath, '--installClient', minecraftRoot], {
        cwd: path.dirname(installerPath),
        logPrefix: 'ForgeInstaller'
    });

    if (installResult.code !== 0) {
        installResult = await runCommandCapture(javaBin, ['-jar', installerPath, '--installClient'], {
            cwd: minecraftRoot,
            logPrefix: 'ForgeInstallerFallback'
        });
    }

    if (installResult.code !== 0) {
        throw new Error(`Forge installer exited with code ${installResult.code}.`);
    }

    const installed = preferredVersionId && fs.existsSync(path.join(minecraftRoot, 'versions', preferredVersionId, `${preferredVersionId}.json`))
        ? preferredVersionId
        : findInstalledVersionMatch(minecraftRoot, 'forge', mcVersion, { strictOfficial: true });

    if (!installed) {
        throw new Error(`Forge ${mcVersion} finished installing, but the version was not found.`);
    }

    return installed;
}

async function getLatestOptiFineJarInfo(mcVersion) {
    const pageHtml = await fetchText(OPTIFINE_DOWNLOADS_URL);
    const directSectionRegex = new RegExp(`adloadx\\?f=(OptiFine_${mcVersion.replace(/\./g, '\\.')}_HD_[^"&]+\\.jar[^"&]*)`, 'i');
    const sectionMatch = pageHtml.match(directSectionRegex);
    if (!sectionMatch) {
        throw new Error(`Could not find an OptiFine download link for ${mcVersion}.`);
    }

    const adloadPath = sectionMatch[0].replace(/&amp;/g, '&');
    const adloadUrl = `https://optifine.net/${adloadPath}`;
    const adloadHtml = await fetchText(adloadUrl);
    const downloadMatch = adloadHtml.match(/downloadx\?f=([^"']+)/i);
    if (!downloadMatch) {
        throw new Error(`Could not find an OptiFine direct download link for ${mcVersion}.`);
    }

    const relative = `downloadx?f=${downloadMatch[1].replace(/&amp;/g, '&')}`;
    const filenameMatch = relative.match(/f=([^&]+)/i);
    return {
        directUrl: `https://optifine.net/${relative}`,
        fileName: filenameMatch ? decodeURIComponent(filenameMatch[1]) : `OptiFine_${mcVersion}.jar`
    };
}

async function ensureOptiFineInstalled(minecraftRoot, mcVersion) {
    const existing = findInstalledVersionMatch(minecraftRoot, 'optifine', mcVersion, { strictOfficial: true });
    if (existing) return existing;

    sendStatus(`Preparing OptiFine ${mcVersion}...`);
    await ensureOfficialVanillaVersion(minecraftRoot, mcVersion);

    const info = await getLatestOptiFineJarInfo(mcVersion);
    const installerPath = path.join(app.getPath('temp'), 'kalilauncher-installers', info.fileName);
    if (!fs.existsSync(installerPath)) {
        sendStatus(`Downloading OptiFine ${mcVersion} installer...`);
        await downloadFile(info.directUrl, installerPath);
    }

    sendStatus(`Opening OptiFine ${mcVersion} installer...`);
    const guiResult = await runCommandCapture(getJavaExecutable(), ['-jar', installerPath], {
        cwd: path.dirname(installerPath),
        logPrefix: 'OptiFineInstaller'
    });

    const installed = findInstalledVersionMatch(minecraftRoot, 'optifine', mcVersion);
    if (installed) return installed;

    if (guiResult.code !== 0) {
        throw new Error(`OptiFine installer closed with code ${guiResult.code}.`);
    }

    throw new Error('The OptiFine installer opened, but no profile was found. Click Install in the installer, then press Play again.');
}

async function launchForgeFromOfficialInstall(username, forgeVersion, launchSettings = {}, instanceRootOverride = null) {
    const minecraftRoot = getOfficialMinecraftRoot();
    await ensureParentVersionsReady(minecraftRoot, forgeVersion);
    const instanceRoot = instanceRootOverride || prepareTbilisiInstance();
    const mergedJson = loadMergedVersionJson(minecraftRoot, forgeVersion);
    const { mainClass, jvmArgs, gameArgs } = buildLaunchArgs(mergedJson, forgeVersion, minecraftRoot, instanceRoot, username, launchSettings);

    const finalArgs = [...jvmArgs, mainClass, ...gameArgs];
    if (!finalArgs.some((arg) => arg === '-cp' || arg === '-p' || arg.startsWith('-cp') || arg.startsWith('-p'))) {
        throw new Error(`Forge ${forgeVersion} is installed, but its launch data is incomplete. Reinstall Forge and try again.`);
    }

    console.log('[ForgeLaunch] mainClass:', mainClass);
    console.log('[ForgeLaunch] args:', finalArgs.join(' '));

    const javaBin = needsJava8ForForge(mergedJson.inheritsFrom || forgeVersion) ? getJavaExecutable(8) : getJavaExecutable();

    activeGameProcess = spawn(javaBin, finalArgs, {
        cwd: minecraftRoot,
        windowsHide: false,
        detached: false
    });

    applyLaunchWindowBehavior();

    activeGameProcess.stdout.on('data', (chunk) => {
        console.log('[Forge][stdout]', chunk.toString());
    });

    activeGameProcess.stderr.on('data', (chunk) => {
        console.log('[Forge][stderr]', chunk.toString());
    });

    activeGameProcess.on('error', (error) => {
        console.error('[ForgeLaunch] Failed:', error);
        showLauncherWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('launch-error', error.message || String(error));
        }
    });

    activeGameProcess.on('close', (code) => {
        console.log('[ForgeLaunch] Game closed with code:', code);
        try {
            exportPackDefaultsFromInstance(instanceRoot);
        } catch (exportError) {
            console.error('[Launcher] Failed to export modpack defaults:', exportError);
        }
        activeGameProcess = null;
        showLauncherWindow();
        if (code !== 0 && win && !win.isDestroyed()) {
            win.webContents.send('launch-error', `Game closed with code ${code}`);
        }
        if (win && !win.isDestroyed()) {
            win.webContents.send('game-closed');
        }
    });
}

function launchInstalledCustomViaMCLC(username, loader, mcVersion, customVersionId, launchSettings = {}) {
    const minecraftRoot = getOfficialMinecraftRoot();
    const instanceRoot = prepareProfileInstance(loader, mcVersion);

    const opts = {
        authorization: getBaseAuth(username),
        root: minecraftRoot,
        javaPath: loader === 'forge' && needsJava8ForForge(mcVersion) ? getJavaExecutable(8) : getJavaExecutable(),
        version: {
            number: mcVersion,
            type: 'release',
            custom: customVersionId
        },
        memory: { max: `${Math.max(2, Number(launchSettings.memoryMax) || 6)}G`, min: `${Math.max(1, Number(launchSettings.memoryMin) || 2)}G` },
        window: {
            width: Number(launchSettings.resolutionWidth) || 1280,
            height: Number(launchSettings.resolutionHeight) || 720,
            fullscreen: Boolean(launchSettings.fullscreen)
        },
        overrides: {
            gameDirectory: instanceRoot
        }
    };

    console.log(`[Launcher] Launching installed ${loader}:`, customVersionId, 'for', mcVersion);
    launcher.launch(opts);
}

ipcMain.handle('get-launcher-config', async () => loadLauncherConfig());

ipcMain.handle('save-launcher-config', async (_event, partialConfig) => {
    const current = loadLauncherConfig();
    return saveLauncherConfig(deepMergeConfig(current, partialConfig || {}));
});

ipcMain.handle('reset-launcher-config', async () => saveLauncherConfig(DEFAULT_LAUNCHER_CONFIG));

ipcMain.handle('get-profile-assets', async () => getProfileAssets());

ipcMain.handle('select-custom-skin', async () => {
    const result = await dialog.showOpenDialog({
        title: 'Choose skin PNG',
        properties: ['openFile'],
        filters: [{ name: 'PNG Skin', extensions: ['png'] }]
    });

    if (result.canceled || !result.filePaths?.length) {
        return { ok: false, cancelled: true };
    }

    const selectedPath = result.filePaths[0];
    if (path.extname(selectedPath).toLowerCase() !== '.png') {
        return { ok: false, error: 'Please select a PNG skin file.' };
    }

    try {
        ensureDir(getProfileRoot());
        fs.copyFileSync(selectedPath, getCustomSkinPath());
        return { ok: true, ...getProfileAssets() };
    } catch (error) {
        console.error('[Profile] Failed to save custom skin:', error);
        return { ok: false, error: error?.message || 'Failed to save custom skin' };
    }
});

ipcMain.handle('clear-custom-skin', async () => {
    try {
        const customSkinPath = getCustomSkinPath();
        if (fs.existsSync(customSkinPath)) fs.unlinkSync(customSkinPath);
        return { ok: true, ...getProfileAssets() };
    } catch (error) {
        console.error('[Profile] Failed to remove custom skin:', error);
        return { ok: false, error: error?.message || 'Failed to remove custom skin' };
    }
});

ipcMain.handle('open-launcher-folder', async (_event, folderKey, payload = {}) => {
    let targetPath = app.getPath('userData');

    if (folderKey === 'minecraftRoot') {
        targetPath = getOfficialMinecraftRoot();
    } else if (folderKey === 'instancesRoot') {
        targetPath = path.join(app.getPath('userData'), '.kalilauncher', 'instances');
    } else if (folderKey === 'tbilisiRoot') {
        targetPath = getInstanceRoot();
    } else if (folderKey === 'launcherRoot') {
        targetPath = app.getPath('userData');
    } else if (folderKey === 'profileRoot') {
        targetPath = getProfileRoot();
    } else if (folderKey === 'currentProfile') {
        targetPath = getCurrentProfileFolderPath(payload?.profile, payload?.version);
    }

    ensureDir(targetPath);
    const error = await shell.openPath(targetPath);
    return error ? { ok: false, error } : { ok: true, path: targetPath };
});

ipcMain.on('open-java-download', async (_event, version = '17') => {
    const normalizedVersion = String(version) === '21' ? '21' : '17';
    await shell.openExternal(`https://adoptium.net/temurin/releases/?version=${normalizedVersion}`);
});

ipcMain.handle('check-for-updates', async () => {
    const updateConfigPath = getUpdaterConfigPath();
    if (!fs.existsSync(updateConfigPath)) {
        return { ok: false, reason: 'Update source is not configured yet. Build with GitHub Releases or UPDATE_URL first.' };
    }

    try {
        if (!updaterInitialized) setupAutoUpdater();
        await autoUpdater.checkForUpdates();
        return { ok: true };
    } catch (error) {
        console.error('[Updater] Manual check failed:', error);
        return { ok: false, reason: error?.message || 'Update check failed' };
    }
});

ipcMain.on('launch-game', async (_event, args) => {
    const incomingConfig = normalizeLauncherConfig({
        username: args?.username,
        selectedProfile: args?.profile,
        selectedVersions: { [args?.profile || 'tbilisi']: args?.version || '1.20.1' },
        settings: args?.settings || {}
    });
    const savedConfig = saveLauncherConfig(deepMergeConfig(loadLauncherConfig(), incomingConfig));
    const username = savedConfig.username;
    const profile = savedConfig.selectedProfile;
    const version = savedConfig.selectedVersions[profile] || args?.version || '1.20.1';
    const launchSettings = savedConfig.settings;

    bindLauncherEvents();

    try {
        const customSkinPath = getCustomSkinPath();
        if (fs.existsSync(customSkinPath)) {
            const launcherProfileRoot = path.join(app.getPath('userData'), '.kalilauncher', 'profile-export');
            ensureDir(launcherProfileRoot);
            fs.copyFileSync(customSkinPath, path.join(launcherProfileRoot, 'custom-skin.png'));
        }
        if (profile === 'tbilisi') {
            const minecraftRoot = getOfficialMinecraftRoot();
            const forgeVersion = await ensureForgeVersionInstalled(minecraftRoot, TBILISI_MC_VERSION, {
                preferredBuild: `${TBILISI_MC_VERSION}-${TBILISI_FORGE_BUILD}`,
                preferredVersionId: TBILISI_FORGE_VERSION_ID
            });

            if (forgeVersion !== TBILISI_FORGE_VERSION_ID) {
                throw new Error(`Expected official Tbilisi Forge profile ${TBILISI_FORGE_VERSION_ID}, but got ${forgeVersion}. Remove custom 1.20.1 Forge packs and try again.`);
            }

            sendStatus('Tbilisi 2077 launching...');
            await launchForgeFromOfficialInstall(username, forgeVersion, launchSettings);
            return;
        }

        if (profile === 'release') {
            const vanillaRoot = path.join(app.getPath('userData'), '.kalilauncher', 'vanilla', sanitizeSegment(version));
            ensureDir(vanillaRoot);

            const opts = {
                authorization: getBaseAuth(username),
                root: vanillaRoot,
                javaPath: getJavaExecutable(),
                version: {
                    number: version,
                    type: 'release'
                },
                memory: { max: `${Math.max(2, Number(launchSettings.memoryMax) || 4)}G`, min: `${Math.max(1, Number(launchSettings.memoryMin) || 2)}G` },
                window: {
                    width: Number(launchSettings.resolutionWidth) || 1280,
                    height: Number(launchSettings.resolutionHeight) || 720,
                    fullscreen: Boolean(launchSettings.fullscreen)
                },
                overrides: {
                    gameDirectory: vanillaRoot
                }
            };

            sendStatus(`Release ${version} launching...`);
            launcher.launch(opts);
            return;
        }

        const minecraftRoot = getOfficialMinecraftRoot();
        let installedVersionId = findInstalledVersionMatch(minecraftRoot, profile, version, { strictOfficial: true });

        if (!installedVersionId && profile === 'forge') {
            installedVersionId = await ensureForgeVersionInstalled(minecraftRoot, version);
        }

        if (!installedVersionId && profile === 'fabric') {
            installedVersionId = await ensureFabricVersionInstalled(minecraftRoot, version);
        }

        if (!installedVersionId && profile === 'optifine') {
            installedVersionId = await ensureOptiFineInstalled(minecraftRoot, version);
        }

        if (!installedVersionId) {
            throw new Error(`${profile[0].toUpperCase()}${profile.slice(1)} ${version} was not found.`);
        }

        if (profile === 'forge') {
            const mergedForgeJson = loadMergedVersionJson(minecraftRoot, installedVersionId);
            const forgeInstanceRoot = prepareProfileInstance(profile, version);
            if (String(mergedForgeJson.mainClass || '').includes('cpw.mods.bootstraplauncher.BootstrapLauncher')) {
                sendStatus(`Forge ${version} launching...`);
                await launchForgeFromOfficialInstall(username, installedVersionId, launchSettings, forgeInstanceRoot);
                return;
            }
        }

        sendStatus(`${profile} ${version} launching...`);
        launchInstalledCustomViaMCLC(username, profile, version, installedVersionId, launchSettings);
    } catch (error) {
        console.error('[Launcher] Launch setup failed:', error);
        showLauncherWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('launch-error', error.message || String(error));
        }
    }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
