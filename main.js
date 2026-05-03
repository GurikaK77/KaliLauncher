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
const USER_AGENT = 'KaliLauncher/3.1.1';

const LAUNCHER_VERSION = '3.1.1';
const TBILISI_MC_VERSION = '1.20.1';
const TBILISI_FORGE_BUILD = '47.4.10';
const TBILISI_FORGE_VERSION_ID = `${TBILISI_MC_VERSION}-forge-${TBILISI_FORGE_BUILD}`;
const ZOMBIE_MODPACK_ID = 'zombie-apocalypse';
const LEGACY_APOC_MODPACK_ID = 'apoc';
const TBILISI_MODPACK_ID = 'tbilisi-2077';
const GURIKA_RESOURCE_DEFINITIONS = [
    {
        id: ZOMBIE_MODPACK_ID,
        folderName: 'zombie-apocalypse',
        legacyFolderName: LEGACY_APOC_MODPACK_ID,
        name: 'Zombie Apocalypse',
        author: 'Gurika',
        description: 'A ready Forge 1.20.1 zombie apocalypse modpack. Put your mods, configs, resource packs, shader packs and settings inside this source folder.',
        status: 'available',
        icon: 'fa-biohazard',
        imageName: 'zombie-apocalypse.svg'
    },
    {
        id: 'coming-soon-1',
        folderName: 'coming-soon-1',
        name: 'Coming Soon',
        author: 'Gurika',
        description: 'Reserved Gurika Resources slot for a future modpack.',
        status: 'coming-soon',
        icon: 'fa-hourglass-half',
        imageName: 'coming-soon-1.svg'
    },
    {
        id: 'coming-soon-2',
        folderName: 'coming-soon-2',
        name: 'Coming Soon',
        author: 'Gurika',
        description: 'Reserved Gurika Resources slot for another future modpack.',
        status: 'coming-soon',
        icon: 'fa-hourglass-half',
        imageName: 'coming-soon-2.svg'
    }
];
const DEFAULT_PACK_SYNC_TARGETS = [
    'mods',
    'config',
    'config/fancymenu',
    'config/fancymenu/assets',
    'config/fancymenu/customization',
    'config/fancymenu/layout_editor',
    'config/drippyloadingscreen',
    'defaultconfigs',
    'fancymenu_data',
    'moonlight-global-data-packs',
    'pointblank',
    'profileImage',
    'resourcepacks',
    'saves',
    'schematics',
    'server-resource-packs',
    'shaderpacks',
    'tacz',
    'tacz_backup',
    'berezka_plugins',
    'manifest.json',
    'modlist.html',
    'options.txt',
    'optionsof.txt',
    'optionsshaders.txt'
];
const DEFAULT_MODPACK_DIRECTORIES = [
    'backups',
    'config',
    'config/fancymenu',
    'config/fancymenu/assets',
    'config/fancymenu/customization',
    'config/fancymenu/layout_editor',
    'config/drippyloadingscreen',
    'crash-reports',
    'defaultconfigs',
    'fancymenu_data',
    'journeymap',
    'logs',
    'mods',
    'moonlight-global-data-packs',
    'pointblank',
    'profileImage',
    'resourcepacks',
    'saves',
    'schematics',
    'server-resource-packs',
    'shaderpacks',
    'tacz',
    'tacz_backup',
    'berezka_plugins'
];
const DEFAULT_MODPACK_FILES = {
    'options.txt': '',
    'optionsof.txt': '',
    'optionsshaders.txt': '',
    'config/fancymenu/customizablemenus.txt': '',
    'config/fancymenu/customizable_screens.txt': '',
    'config/fancymenu/customizablebuttons.txt': '',
    'config/fancymenu/customizable_titles.txt': '',
    'config/fancymenu/options.txt': '',
    'config/drippyloadingscreen/options.txt': ''
};

const FANCYMENU_COMPAT_DIRECTORIES = [
    'config',
    'config/fancymenu',
    'config/fancymenu/assets',
    'config/fancymenu/customization',
    'config/fancymenu/layout_editor',
    'config/fancymenu/layouts',
    'config/fancymenu/resources',
    'config/fancymenu/slideshows',
    'config/drippyloadingscreen'
];

const FANCYMENU_COMPAT_FILES = {
    'config/fancymenu/customizablemenus.txt': '',
    'config/fancymenu/customizable_screens.txt': '',
    'config/fancymenu/customizablebuttons.txt': '',
    'config/fancymenu/customizable_titles.txt': '',
    'config/fancymenu/options.txt': '',
    'config/drippyloadingscreen/options.txt': ''
};
const DEFAULT_MODPACK_JSON_FILES = {
    'usercache.json': () => [],
    'usernamecache.json': () => ({})
};
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

function getLauncherDataRoot() {
    return path.join(app.getPath('userData'), '.kalilauncher');
}

function getInstancesRoot() {
    return path.join(getLauncherDataRoot(), 'instances');
}

function getSystemMinecraftRoot() {
    return path.join(app.getPath('appData'), '.minecraft');
}

function getLauncherMinecraftRoot() {
    const root = path.join(getLauncherDataRoot(), 'runtime', '.minecraft');
    for (const dirPath of [
        root,
        path.join(root, 'versions'),
        path.join(root, 'libraries'),
        path.join(root, 'assets'),
        path.join(root, 'assets', 'indexes'),
        path.join(root, 'assets', 'objects'),
        path.join(root, 'natives')
    ]) {
        ensureDir(dirPath);
    }
    ensureLauncherMetadataFiles(root);
    ensureFancyMenuCompatibilityFiles(root);
    return root;
}

function getDefaultLauncherProfilePayload() {
    const now = new Date().toISOString();
    return {
        profiles: {
            KaliLauncher: {
                created: now,
                icon: 'Grass',
                lastUsed: now,
                lastVersionId: 'latest-release',
                name: 'KaliLauncher',
                type: 'custom'
            }
        },
        selectedProfile: 'KaliLauncher',
        clientToken: '00000000-0000-0000-0000-000000000000',
        authenticationDatabase: {},
        settings: {
            crashAssistance: true,
            enableAdvanced: false,
            enableAnalytics: false,
            keepLauncherOpen: false,
            showGameLog: false
        },
        version: 3
    };
}

function ensureJsonFile(filePath, fallbackFactory) {
    if (fs.existsSync(filePath)) {
        try {
            JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return;
        } catch {
            // Rewrite broken files with a safe default payload.
        }
    }

    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(fallbackFactory(), null, 2));
}

function ensureLauncherMetadataFiles(minecraftRoot) {
    ensureJsonFile(path.join(minecraftRoot, 'launcher_profiles.json'), getDefaultLauncherProfilePayload);
    ensureJsonFile(path.join(minecraftRoot, 'launcher_profiles_microsoft_store.json'), getDefaultLauncherProfilePayload);
    ensureJsonFile(path.join(minecraftRoot, 'launcher_accounts.json'), () => ({ accounts: {}, activeAccountLocalId: null }));
}

function buildIsolatedProcessEnv(minecraftRoot = getLauncherMinecraftRoot()) {
    const runtimeRoot = path.dirname(minecraftRoot);
    const env = {
        ...process.env,
        APPDATA: runtimeRoot,
        MINECRAFT_HOME: minecraftRoot,
        KALILAUNCHER_DATA: getLauncherDataRoot(),
        KALILAUNCHER_MINECRAFT_ROOT: minecraftRoot
    };

    if (process.platform !== 'win32') {
        env.HOME = runtimeRoot;
    }

    return env;
}

function getProfileRoot() {
    return path.join(getLauncherDataRoot(), 'profile');
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

function formatPackNameFromId(packId) {
    return String(packId || 'Modpack')
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((segment) => segment[0].toUpperCase() + segment.slice(1))
        .join(' ') || 'Modpack';
}

function getModpackFilesRoot() {
    return path.join(__dirname, 'modpack_files');
}

function getSourceModpackRoot(packId) {
    return path.join(getModpackFilesRoot(), sanitizeSegment(packId));
}

function getTbilisiSourceRoot() {
    return getSourceModpackRoot(TBILISI_MODPACK_ID);
}

function getResourceCoverRoot() {
    return path.join(__dirname, 'assets', 'modpack-covers');
}

function getResourceDefinitionById(packId) {
    const normalizedId = sanitizeSegment(packId);
    return GURIKA_RESOURCE_DEFINITIONS.find((entry) => entry.id === normalizedId) || null;
}

function getResourceSourceRoot(definition) {
    if (!definition) return getModpackFilesRoot();
    if (definition.legacyFolderName) {
        const legacyRoot = getSourceModpackRoot(definition.legacyFolderName);
        const nextRoot = getSourceModpackRoot(definition.folderName || definition.id);
        if (fs.existsSync(legacyRoot) && !fs.existsSync(nextRoot)) {
            return legacyRoot;
        }
    }
    return getSourceModpackRoot(definition.folderName || definition.id);
}

function getResourceCoverPath(definition) {
    return path.join(getResourceCoverRoot(), definition?.imageName || `${sanitizeSegment(definition?.id || 'modpack')}.svg`);
}

function getSourcePackFallback(packId, overrides = {}) {
    const id = sanitizeSegment(packId || 'modpack');
    const definition = getResourceDefinitionById(id);
    const isTbilisi = id === TBILISI_MODPACK_ID;
    const fallbackName = definition?.name || (isTbilisi ? 'Tbilisi 2077' : formatPackNameFromId(id));
    return {
        id,
        name: fallbackName,
        author: definition?.author || 'Gurika',
        description: definition?.description || (isTbilisi
            ? 'Legacy Forge 1.20.1 pack shipped with KaliLauncher.'
            : 'Forge 1.20.1 modpack source for KaliLauncher.'),
        loader: 'forge',
        mcVersion: TBILISI_MC_VERSION,
        forgeBuild: TBILISI_FORGE_BUILD,
        versionId: TBILISI_FORGE_VERSION_ID,
        sourceType: isTbilisi ? 'source-default' : 'gurika-resource',
        status: definition?.status || 'available',
        icon: definition?.icon || (isTbilisi ? 'fa-city' : 'fa-cube'),
        image: definition?.imageName || '',
        ...overrides
    };
}

function getModpackLibraryRoot() {
    return path.join(getLauncherDataRoot(), 'modpacks');
}

function getInstalledModpackRoot(packId) {
    return path.join(getModpackLibraryRoot(), sanitizeSegment(packId));
}

function getKnownModpackManifestNames() {
    return ['kalilauncher-pack.json', 'pack.json', 'manifest.json'];
}

function getDefaultZombieManifest() {
    return getSourcePackFallback(ZOMBIE_MODPACK_ID, {
        description: 'Zombie Apocalypse pack for KaliLauncher with a Forge 1.20.1 base and its own modpack_files source folder.'
    });
}

function getLauncherPackManifestPath(rootPath) {
    return path.join(rootPath, 'kalilauncher-pack.json');
}

function normalizePackManifest(raw = {}, fallback = {}) {
    const source = { ...fallback, ...(raw || {}) };
    const normalizedLoader = ['forge', 'fabric', 'release', 'optifine'].includes(String(source.loader || '').toLowerCase())
        ? String(source.loader).toLowerCase()
        : String(fallback.loader || 'forge').toLowerCase();
    const mcVersion = String(source.mcVersion || source.minecraftVersion || source.gameVersion || source.version || fallback.mcVersion || TBILISI_MC_VERSION);
    const forgeBuild = String(source.forgeBuild || source.loaderVersion || source.forgeVersion || fallback.forgeBuild || TBILISI_FORGE_BUILD);
    const name = String(source.name || fallback.name || 'Imported Pack').trim() || 'Imported Pack';
    const id = sanitizeSegment(source.id || fallback.id || name);
    return {
        id,
        name,
        author: String(source.author || fallback.author || 'Gurika').trim() || 'Gurika',
        description: String(source.description || fallback.description || 'Local Forge pack for KaliLauncher.').trim() || 'Local Forge pack for KaliLauncher.',
        loader: normalizedLoader,
        mcVersion,
        forgeBuild,
        versionId: String(source.versionId || source.forgeVersionId || fallback.versionId || `${mcVersion}-forge-${forgeBuild}`),
        sourceType: String(source.sourceType || fallback.sourceType || 'custom'),
        status: String(source.status || fallback.status || 'available'),
        icon: String(source.icon || fallback.icon || 'fa-cube'),
        image: String(source.image || fallback.image || ''),
        importedAt: String(source.importedAt || fallback.importedAt || '')
    };
}

function readModpackManifest(rootPath, fallback = {}) {
    for (const fileName of getKnownModpackManifestNames()) {
        const filePath = path.join(rootPath, fileName);
        if (!fs.existsSync(filePath)) continue;
        try {
            return normalizePackManifest(JSON.parse(fs.readFileSync(filePath, 'utf8')), fallback);
        } catch (error) {
            console.warn('[Modpacks] Failed to read manifest:', filePath, error);
        }
    }
    return normalizePackManifest({}, fallback);
}

function writeModpackManifest(rootPath, manifest) {
    ensureDir(rootPath);
    const normalized = normalizePackManifest(manifest, manifest);
    fs.writeFileSync(getLauncherPackManifestPath(rootPath), JSON.stringify(normalized, null, 2));
    return normalized;
}

function removePathIfExists(targetPath) {
    if (!fs.existsSync(targetPath)) return;
    fs.rmSync(targetPath, { recursive: true, force: true });
}

function countFilesInDirectory(rootPath, allowedExtensions = null) {
    if (!fs.existsSync(rootPath)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
        const fullPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
            count += countFilesInDirectory(fullPath, allowedExtensions);
            continue;
        }
        if (!allowedExtensions || allowedExtensions.includes(path.extname(entry.name).toLowerCase())) {
            count += 1;
        }
    }
    return count;
}

function getModpackStats(rootPath) {
    return {
        modCount: countFilesInDirectory(path.join(rootPath, 'mods'), ['.jar']),
        hasConfig: fs.existsSync(path.join(rootPath, 'config')),
        hasDefaultConfigs: fs.existsSync(path.join(rootPath, 'defaultconfigs'))
    };
}

function ensureTextFile(filePath, fallback = '') {
    if (fs.existsSync(filePath)) return;
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, fallback, 'utf8');
}

function ensureFancyMenuCompatibilityFiles(rootPath) {
    if (!rootPath) return;
    ensureDir(rootPath);

    for (const relativeDir of FANCYMENU_COMPAT_DIRECTORIES) {
        ensureDir(path.join(rootPath, relativeDir));
    }

    for (const [relativeFile, fallback] of Object.entries(FANCYMENU_COMPAT_FILES)) {
        ensureTextFile(path.join(rootPath, relativeFile), fallback);
    }
}

function ensureStandardModpackStructure(rootPath) {
    ensureDir(rootPath);

    for (const relativeDir of DEFAULT_MODPACK_DIRECTORIES) {
        ensureDir(path.join(rootPath, relativeDir));
    }

    for (const [relativeFile, fallback] of Object.entries(DEFAULT_MODPACK_FILES)) {
        ensureTextFile(path.join(rootPath, relativeFile), fallback);
    }

    for (const [relativeFile, fallbackFactory] of Object.entries(DEFAULT_MODPACK_JSON_FILES)) {
        ensureJsonFile(path.join(rootPath, relativeFile), fallbackFactory);
    }

    ensureFancyMenuCompatibilityFiles(rootPath);

    return rootPath;
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

function resolvePreferredJavaMajor(mcVersion, loader = 'release') {
    const normalized = String(mcVersion || '');
    if (loader === 'forge' && needsJava8ForForge(normalized)) return 8;

    const match = normalized.match(/^1\.(\d+)(?:\.(\d+))?/);
    if (!match) return null;

    const minor = Number(match[1]);
    const patch = Number(match[2] || 0);

    if (minor >= 21) return 21;
    if (minor === 20 && patch >= 5) return 21;
    if (minor >= 17) return 17;
    return 8;
}

function getJavaExecutable(requiredMajor = null) {
    if ([8, 17, 21].includes(requiredMajor)) {
        const envMap = {
            8: [process.env.JAVA8_HOME, process.env.JRE8_HOME],
            17: [process.env.JAVA17_HOME, process.env.JDK17_HOME],
            21: [process.env.JAVA21_HOME, process.env.JDK21_HOME]
        };

        const envCandidates = (envMap[requiredMajor] || [])
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

        const patternMap = {
            8: [/jdk.*1\.8/, /jre.*1\.8/, /jdk-?8/, /jre-?8/, /temurin.*8/, /corretto.*8/],
            17: [/jdk.*17/, /jre.*17/, /jdk-?17/, /jre-?17/, /temurin.*17/, /corretto.*17/],
            21: [/jdk.*21/, /jre.*21/, /jdk-?21/, /jre-?21/, /temurin.*21/, /corretto.*21/]
        };

        const found = findJavaExecutableInRoots(roots, patternMap[requiredMajor] || []);
        if (found) return found;

        if (requiredMajor === 8) {
            throw new Error('Forge 1.16.5 and below need Java 8. Install Java 8 first, then try again.');
        }

        if (requiredMajor === 17) {
            throw new Error('Minecraft 1.17 to 1.20.4 needs Java 17. Install Java 17 first, then try again.');
        }

        if (requiredMajor === 21) {
            throw new Error('Minecraft 1.20.5+ needs Java 21. Install Java 21 first, then try again.');
        }
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
        width: 1320,
        height: 860,
        minWidth: 1080,
        minHeight: 720,
        resizable: true,
        backgroundColor: '#05030c',
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

function syncModpackSourceToTarget(sourceRoot, targetRoot) {
    ensureDir(targetRoot);
    for (const relativeTarget of DEFAULT_PACK_SYNC_TARGETS) {
        const sourcePath = path.join(sourceRoot, relativeTarget);
        const targetPath = path.join(targetRoot, relativeTarget);
        removePathIfExists(targetPath);
        if (fs.existsSync(sourcePath)) {
            copyPathIfExists(sourcePath, targetPath);
        }
    }
}

function preparePackInstanceFromSource(sourceRoot, instanceRoot) {
    ensureStandardModpackStructure(instanceRoot);
    syncModpackSourceToTarget(sourceRoot, instanceRoot);
    ensureStandardModpackStructure(instanceRoot);
    return instanceRoot;
}

function looksLikeModpackRoot(rootPath) {
    if (!fs.existsSync(rootPath)) return false;
    if (getKnownModpackManifestNames().some((fileName) => fs.existsSync(path.join(rootPath, fileName)))) return true;
    return ['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks']
        .some((entry) => fs.existsSync(path.join(rootPath, entry)));
}

function detectImportedModpackRoot(rootPath) {
    if (looksLikeModpackRoot(rootPath)) return rootPath;

    const childDirs = fs.readdirSync(rootPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== '__MACOSX')
        .map((entry) => path.join(rootPath, entry.name));

    if (childDirs.length === 1 && looksLikeModpackRoot(childDirs[0])) {
        return childDirs[0];
    }

    return rootPath;
}

function getUniqueModpackId(baseId) {
    const normalizedBase = sanitizeSegment(baseId || 'modpack');
    const root = getModpackLibraryRoot();
    ensureDir(root);
    let nextId = normalizedBase;
    let index = 2;
    while (fs.existsSync(path.join(root, nextId))) {
        nextId = `${normalizedBase}-${index}`;
        index += 1;
    }
    return nextId;
}

function installModpackFromSource(sourceRoot, manifest, options = {}) {
    const overwrite = Boolean(options.overwrite);
    const requestedId = sanitizeSegment(manifest.id || manifest.name || 'modpack');
    const finalId = overwrite ? requestedId : getUniqueModpackId(requestedId);
    const targetRoot = getInstalledModpackRoot(finalId);
    removePathIfExists(targetRoot);
    ensureDir(path.dirname(targetRoot));
    copyFolderSync(sourceRoot, targetRoot);
    ensureStandardModpackStructure(targetRoot);
    const storedManifest = writeModpackManifest(targetRoot, {
        ...manifest,
        id: finalId,
        sourceType: options.sourceType || manifest.sourceType || 'installed',
        importedAt: new Date().toISOString()
    });
    return {
        ...storedManifest,
        rootPath: targetRoot,
        ...getModpackStats(targetRoot)
    };
}

function isPathInside(parentPath, childPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function deleteInstalledModpack(packId) {
    const id = sanitizeSegment(packId);
    if (!id) {
        throw new Error('Invalid modpack id.');
    }

    const libraryRoot = getModpackLibraryRoot();
    const targetRoot = getInstalledModpackRoot(id);
    if (!isPathInside(libraryRoot, targetRoot)) {
        throw new Error('Blocked unsafe modpack delete path.');
    }

    if (!fs.existsSync(targetRoot)) {
        return null;
    }

    const manifest = readModpackManifest(targetRoot, {
        id,
        name: formatPackNameFromId(id),
        sourceType: 'installed'
    });

    removePathIfExists(targetRoot);

    const instanceModpacksRoot = path.join(getInstancesRoot(), 'modpacks');
    const runtimeRoot = path.join(instanceModpacksRoot, id);
    if (isPathInside(instanceModpacksRoot, runtimeRoot)) {
        removePathIfExists(runtimeRoot);
    }

    return {
        ...manifest,
        id,
        rootPath: targetRoot
    };
}

function listInstalledModpacks() {
    const root = getModpackLibraryRoot();
    ensureDir(root);
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const packRoot = path.join(root, entry.name);
            const manifest = readModpackManifest(packRoot, {
                id: entry.name,
                name: entry.name,
                sourceType: 'installed'
            });
            return {
                ...manifest,
                rootPath: packRoot,
                ...getModpackStats(packRoot)
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
}

function getPlaceholderCoverSvg(definition) {
    const title = definition?.name || 'Modpack';
    const subtitle = definition?.status === 'coming-soon' ? 'Coming soon' : 'Forge 1.20.1';
    const safeTitle = String(title).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
    const safeSubtitle = String(subtitle).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1028"/>
      <stop offset="0.54" stop-color="#3a155f"/>
      <stop offset="1" stop-color="#071d26"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.72" cy="0.18" r="0.72">
      <stop offset="0" stop-color="#ffbc62" stop-opacity="0.72"/>
      <stop offset="1" stop-color="#ffbc62" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" rx="42" fill="url(#bg)"/>
  <rect width="1200" height="675" rx="42" fill="url(#glow)"/>
  <circle cx="980" cy="158" r="136" fill="#33d7ff" opacity="0.16"/>
  <circle cx="210" cy="528" r="192" fill="#8f57ff" opacity="0.18"/>
  <text x="70" y="118" fill="#ffdf9a" font-family="Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="8">GURIKA RESOURCES</text>
  <text x="70" y="356" fill="#ffffff" font-family="Arial, sans-serif" font-size="86" font-weight="800">${safeTitle}</text>
  <text x="76" y="430" fill="#d7d8ff" font-family="Arial, sans-serif" font-size="38" font-weight="600">${safeSubtitle}</text>
  <text x="76" y="580" fill="#ffffff" opacity="0.56" font-family="Arial, sans-serif" font-size="26">Replace this SVG with your own cover image later.</text>
</svg>`;
}

function ensureGurikaResourceFolders() {
    ensureDir(getModpackFilesRoot());
    ensureDir(getResourceCoverRoot());

    for (const definition of GURIKA_RESOURCE_DEFINITIONS) {
        const sourceRoot = getResourceSourceRoot(definition);
        ensureDir(sourceRoot);
        if (definition.status === 'available') {
            ensureStandardModpackStructure(sourceRoot);
        }

        const coverPath = getResourceCoverPath(definition);
        if (!fs.existsSync(coverPath)) {
            fs.writeFileSync(coverPath, getPlaceholderCoverSvg(definition), 'utf8');
        }

        const manifestPath = getLauncherPackManifestPath(sourceRoot);
        if (!fs.existsSync(manifestPath)) {
            writeModpackManifest(sourceRoot, getSourcePackFallback(definition.id, {
                id: definition.id,
                name: definition.name,
                status: definition.status,
                sourceType: 'gurika-resource',
                image: definition.imageName
            }));
        }
    }
}

function listSourceModpacks() {
    ensureGurikaResourceFolders();

    return GURIKA_RESOURCE_DEFINITIONS.map((definition, index) => {
        const packRoot = getResourceSourceRoot(definition);
        const manifest = readModpackManifest(packRoot, getSourcePackFallback(definition.id, {
            id: definition.id,
            name: definition.name,
            status: definition.status,
            sourceType: 'gurika-resource',
            image: definition.imageName
        }));
        const installedRoot = getInstalledModpackRoot(manifest.id);
        const installed = fs.existsSync(installedRoot);
        const coverPath = getResourceCoverPath(definition);
        return {
            ...manifest,
            id: definition.id,
            name: definition.name,
            description: manifest.description || definition.description,
            status: definition.status,
            icon: manifest.icon || definition.icon,
            image: manifest.image || definition.imageName,
            coverPath,
            order: index,
            rootPath: packRoot,
            sourcePath: packRoot,
            installed,
            installedPath: installed ? installedRoot : null,
            ...getModpackStats(packRoot)
        };
    }).sort((left, right) => left.order - right.order);
}

function getSourceModpackById(packId) {
    const normalizedId = sanitizeSegment(packId);
    return listSourceModpacks().find((entry) => entry.id === normalizedId) || null;
}

function getGurikaResourcesCatalog() {
    return listSourceModpacks();
}

function getModpackHubData() {
    return {
        resources: getGurikaResourcesCatalog(),
        library: listInstalledModpacks(),
        sourceRoot: getModpackFilesRoot(),
        modpacksRoot: getModpackLibraryRoot()
    };
}

function getOfficialMinecraftRoot() {
    return getLauncherMinecraftRoot();
}

function getInstanceRoot() {
    return path.join(getInstancesRoot(), TBILISI_MODPACK_ID);
}

function sanitizeSegment(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

function prepareProfileInstance(profile, version) {
    const instanceRoot = getCurrentProfileFolderPath(profile, version);
    ensureDir(instanceRoot);
    for (const folder of ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves']) {
        ensureDir(path.join(instanceRoot, folder));
    }
    return instanceRoot;
}

function getCurrentProfileFolderPath(profile, version) {
    if (profile === 'tbilisi') return getInstanceRoot();
    if (profile === 'release') {
        return path.join(getLauncherDataRoot(), 'vanilla', sanitizeSegment(version || '1.20.1'));
    }
    return path.join(getInstancesRoot(), `${sanitizeSegment(profile || 'release')}-${sanitizeSegment(version || '1.20.1')}`);
}

function prepareTbilisiInstance() {
    const instanceRoot = getInstanceRoot();
    return preparePackInstanceFromSource(getTbilisiSourceRoot(), instanceRoot);
}

function exportPackDefaultsFromInstance(instanceRoot, modpackRoot = getTbilisiSourceRoot()) {
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
            env: options.env || process.env,
            windowsHide: options.windowsHide ?? true,
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

function escapePowerShellLiteral(value) {
    return String(value).replace(/'/g, "''");
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

    const javaBin = getJavaExecutable(resolvePreferredJavaMajor(mcVersion, 'forge'));

    sendStatus(`Installing Forge ${mcVersion}...`);
    let installResult = await runCommandCapture(javaBin, ['-jar', installerPath, '--installClient', minecraftRoot], {
        cwd: path.dirname(installerPath),
        env: buildIsolatedProcessEnv(minecraftRoot),
        logPrefix: 'ForgeInstaller'
    });

    if (installResult.code !== 0) {
        installResult = await runCommandCapture(javaBin, ['-jar', installerPath, '--installClient'], {
            cwd: minecraftRoot,
            env: buildIsolatedProcessEnv(minecraftRoot),
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
    const guiResult = await runCommandCapture(getJavaExecutable(resolvePreferredJavaMajor(mcVersion, 'optifine')), ['-jar', installerPath], {
        cwd: path.dirname(installerPath),
        env: buildIsolatedProcessEnv(minecraftRoot),
        windowsHide: false,
        logPrefix: 'OptiFineInstaller'
    });

    const installed = findInstalledVersionMatch(minecraftRoot, 'optifine', mcVersion);
    if (installed) return installed;

    if (guiResult.code !== 0) {
        throw new Error(`OptiFine installer closed with code ${guiResult.code}.`);
    }

    throw new Error('The OptiFine installer opened, but no profile was found. Install into the KaliLauncher runtime that opened by default, then press Play again.');
}

async function launchForgeFromOfficialInstall(username, forgeVersion, launchSettings = {}, instanceRootOverride = null, exportRoot = getTbilisiSourceRoot()) {
    const minecraftRoot = getOfficialMinecraftRoot();
    await ensureParentVersionsReady(minecraftRoot, forgeVersion);
    const instanceRoot = instanceRootOverride || prepareTbilisiInstance();

    ensureStandardModpackStructure(instanceRoot);
    ensureFancyMenuCompatibilityFiles(instanceRoot);
    ensureFancyMenuCompatibilityFiles(minecraftRoot);

    const mergedJson = loadMergedVersionJson(minecraftRoot, forgeVersion);
    const { mainClass, jvmArgs, gameArgs } = buildLaunchArgs(mergedJson, forgeVersion, minecraftRoot, instanceRoot, username, launchSettings);

    const finalArgs = [...jvmArgs, mainClass, ...gameArgs];
    if (!finalArgs.some((arg) => arg === '-cp' || arg === '-p' || arg.startsWith('-cp') || arg.startsWith('-p'))) {
        throw new Error(`Forge ${forgeVersion} is installed, but its launch data is incomplete. Reinstall Forge and try again.`);
    }

    console.log('[ForgeLaunch] mainClass:', mainClass);
    console.log('[ForgeLaunch] args:', finalArgs.join(' '));

    const javaBin = getJavaExecutable(resolvePreferredJavaMajor(mergedJson.inheritsFrom || forgeVersion, 'forge'));

    activeGameProcess = spawn(javaBin, finalArgs, {
        cwd: instanceRoot,
        env: {
            ...buildIsolatedProcessEnv(minecraftRoot),
            KALILAUNCHER_INSTANCE_ROOT: instanceRoot
        },
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
        if (exportRoot) {
            try {
                exportPackDefaultsFromInstance(instanceRoot, exportRoot);
            } catch (exportError) {
                console.error('[Launcher] Failed to export modpack defaults:', exportError);
            }
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
        javaPath: getJavaExecutable(resolvePreferredJavaMajor(mcVersion, loader)),
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

function getInstalledModpackById(packId) {
    return listInstalledModpacks().find((entry) => entry.id === sanitizeSegment(packId)) || null;
}

async function launchCustomModpack(packId, username, launchSettings = {}) {
    const pack = getInstalledModpackById(packId);
    if (!pack) {
        throw new Error(`Modpack "${packId}" was not found in your library.`);
    }

    if (pack.loader !== 'forge') {
        throw new Error(`Only Forge modpacks are supported right now. "${pack.name}" uses ${pack.loader}.`);
    }

    const minecraftRoot = getOfficialMinecraftRoot();
    const forgeVersion = await ensureForgeVersionInstalled(minecraftRoot, pack.mcVersion, {
        preferredBuild: `${pack.mcVersion}-${pack.forgeBuild}`,
        preferredVersionId: pack.versionId
    });

    const instanceRoot = path.join(getInstancesRoot(), 'modpacks', sanitizeSegment(pack.id));
    preparePackInstanceFromSource(pack.rootPath, instanceRoot);
    sendStatus(`${pack.name} launching...`);
    await launchForgeFromOfficialInstall(username, forgeVersion, launchSettings, instanceRoot, null);
    return pack;
}

ipcMain.handle('get-launcher-config', async () => loadLauncherConfig());

ipcMain.handle('save-launcher-config', async (_event, partialConfig) => {
    const current = loadLauncherConfig();
    return saveLauncherConfig(deepMergeConfig(current, partialConfig || {}));
});

ipcMain.handle('reset-launcher-config', async () => saveLauncherConfig(DEFAULT_LAUNCHER_CONFIG));

ipcMain.handle('get-profile-assets', async () => getProfileAssets());

ipcMain.handle('get-modpack-hub', async () => getModpackHubData());

ipcMain.handle('install-gurika-modpack', async (_event, packId = ZOMBIE_MODPACK_ID) => {
    try {
        const requestedId = sanitizeSegment(packId);
        const sourcePack = getSourceModpackById(requestedId);
        if (!sourcePack) {
            return { ok: false, error: 'That Gurika Resources pack was not found.' };
        }
        if (sourcePack.status !== 'available') {
            return { ok: false, error: `${sourcePack.name || 'This pack'} is coming soon and cannot be downloaded yet.` };
        }
        if (!fs.existsSync(sourcePack.rootPath)) {
            return { ok: false, error: 'The source modpack folder was not found inside modpack_files.' };
        }

        const pack = installModpackFromSource(sourcePack.rootPath, sourcePack, {
            overwrite: true,
            sourceType: 'gurika-installed'
        });
        return { ok: true, pack, hub: getModpackHubData() };
    } catch (error) {
        console.error('[Modpacks] Failed to install Gurika pack:', error);
        return { ok: false, error: error?.message || 'Failed to download the Gurika Resources pack.' };
    }
});

ipcMain.handle('delete-installed-modpack', async (_event, packId) => {
    try {
        const deletedPack = deleteInstalledModpack(packId);
        if (!deletedPack) {
            return { ok: false, error: 'This modpack is not downloaded in your library.' };
        }
        return { ok: true, pack: deletedPack, hub: getModpackHubData() };
    } catch (error) {
        console.error('[Modpacks] Failed to delete installed pack:', error);
        return { ok: false, error: error?.message || 'Failed to delete the downloaded modpack.' };
    }
});

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
    let targetPath = getLauncherDataRoot();

    if (folderKey === 'minecraftRoot') {
        targetPath = getOfficialMinecraftRoot();
    } else if (folderKey === 'instancesRoot') {
        targetPath = getInstancesRoot();
    } else if (folderKey === 'tbilisiRoot') {
        targetPath = getInstanceRoot();
    } else if (folderKey === 'launcherRoot') {
        targetPath = getLauncherDataRoot();
    } else if (folderKey === 'profileRoot') {
        targetPath = getProfileRoot();
    } else if (folderKey === 'currentProfile') {
        targetPath = getCurrentProfileFolderPath(payload?.profile, payload?.version);
    } else if (folderKey === 'modpacksRoot') {
        targetPath = getModpackLibraryRoot();
    } else if (folderKey === 'modpackFilesRoot' || folderKey === 'modpackStudioRoot') {
        targetPath = getModpackFilesRoot();
    } else if (folderKey === 'zombieSourceRoot' || folderKey === 'primaryResourceSourceRoot') {
        targetPath = getSourceModpackById(ZOMBIE_MODPACK_ID)?.rootPath || getResourceSourceRoot(getResourceDefinitionById(ZOMBIE_MODPACK_ID));
    } else if (folderKey === 'resourcePackSource') {
        targetPath = getSourceModpackById(payload?.packId)?.rootPath || getModpackFilesRoot();
    } else if (folderKey === 'modpackRoot') {
        const pack = getInstalledModpackById(payload?.packId);
        targetPath = pack?.rootPath || getModpackLibraryRoot();
    }

    const resolvedTarget = path.resolve(targetPath).toLowerCase();
    const modpackFilesRoot = path.resolve(getModpackFilesRoot()).toLowerCase();
    if (!fs.existsSync(targetPath) && !resolvedTarget.startsWith(modpackFilesRoot)) {
        ensureDir(targetPath);
    }
    const error = await shell.openPath(targetPath);
    return error ? { ok: false, error } : { ok: true, path: targetPath };
});

ipcMain.handle('get-launcher-paths', async (_event, payload = {}) => {
    const requestedProfile = payload?.profile || DEFAULT_LAUNCHER_CONFIG.selectedProfile;
    const requestedVersion = payload?.version || DEFAULT_LAUNCHER_CONFIG.selectedVersions[requestedProfile] || '1.20.1';
    return {
        launcherDataRoot: getLauncherDataRoot(),
        minecraftRoot: getOfficialMinecraftRoot(),
        systemMinecraftRoot: getSystemMinecraftRoot(),
        instancesRoot: getInstancesRoot(),
        modpacksRoot: getModpackLibraryRoot(),
        modpackFilesRoot: getModpackFilesRoot(),
        zombieSourceRoot: getSourceModpackById(ZOMBIE_MODPACK_ID)?.rootPath || getResourceSourceRoot(getResourceDefinitionById(ZOMBIE_MODPACK_ID)),
        profileRoot: getProfileRoot(),
        currentProfile: getCurrentProfileFolderPath(requestedProfile, requestedVersion)
    };
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

ipcMain.handle('launch-modpack', async (_event, args = {}) => {
    const current = loadLauncherConfig();
    const savedConfig = saveLauncherConfig(deepMergeConfig(current, {
        username: args?.username || current.username,
        settings: args?.settings || current.settings
    }));

    bindLauncherEvents();

    try {
        await launchCustomModpack(args?.packId, savedConfig.username, savedConfig.settings);
        return { ok: true };
    } catch (error) {
        console.error('[Modpacks] Launch failed:', error);
        showLauncherWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('launch-error', error.message || String(error));
        }
        return { ok: false, error: error?.message || 'Failed to launch modpack.' };
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
            const launcherProfileRoot = path.join(getLauncherDataRoot(), 'profile-export');
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
                throw new Error(`Expected isolated Tbilisi Forge profile ${TBILISI_FORGE_VERSION_ID}, but got ${forgeVersion}. Remove old custom 1.20.1 Forge data inside KaliLauncher and try again.`);
            }

            sendStatus('Tbilisi 2077 launching...');
            await launchForgeFromOfficialInstall(username, forgeVersion, launchSettings);
            return;
        }

        if (profile === 'release') {
            const minecraftRoot = getOfficialMinecraftRoot();
            const vanillaRoot = prepareProfileInstance(profile, version);

            const opts = {
                authorization: getBaseAuth(username),
                root: minecraftRoot,
                javaPath: getJavaExecutable(resolvePreferredJavaMajor(version, 'release')),
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
                await launchForgeFromOfficialInstall(username, installedVersionId, launchSettings, forgeInstanceRoot, null);
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
