'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { Client } = require('minecraft-launcher-core');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

// ─── Constants ─────────────────────────────────────────────────────────────────

const LAUNCHER_VERSION = '3.4.0';
const USER_AGENT = `KaliLauncher/${LAUNCHER_VERSION}`;
const MOJANG_VERSION_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META = 'https://meta.fabricmc.net';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const FORGE_FILES = 'https://files.minecraftforge.net/net/minecraftforge/forge';

// ─── Modpack Definitions ───────────────────────────────────────────────────────
// To add a modpack: add an entry here and create modpack_files/<id>/ folder.
// Forge: { loader:'forge', mcVersion, forgeBuild, versionId }
// Fabric: { loader:'fabric', mcVersion }

const GURIKA_PACKS = [
    {
        id: 'zombie-apocalypse',
        name: 'Zombie Apocalypse',
        author: 'Gurika',
        description: 'Forge 1.20.1 zombie survival modpack.',
        loader: 'forge',
        mcVersion: '1.20.1',
        forgeBuild: '47.4.14',
        versionId: '1.20.1-forge-47.4.14',
        status: 'available',
        icon: 'fa-biohazard',
        imageName: 'zombie-apocalypse.svg'
    },
    {
        id: 'medieval',
        name: 'Medieval',
        author: 'Gurika',
        description: 'Fabric 1.20.1 medieval fantasy modpack.',
        loader: 'fabric',
        mcVersion: '1.20.1',
        status: 'available',
        icon: 'fa-dungeon',
        imageName: 'coming-soon-1.svg'
    },
    {
        id: 'survival-fantasy',
        name: 'Survival (Fantasy)',
        author: 'Gurika',
        description: 'Forge 1.20.1 fantasy survival modpack.',
        loader: 'forge',
        mcVersion: '1.20.1',
        forgeBuild: '47.4.10',
        versionId: '1.20.1-forge-47.4.10',
        status: 'available',
        icon: 'fa-dragon',
        imageName: 'coming-soon-2.svg'
    },
    {
        id: 'coming-soon-1',
        name: 'Coming Soon',
        author: 'Gurika',
        description: 'Reserved slot.',
        status: 'coming-soon',
        icon: 'fa-hourglass-half',
        imageName: 'coming-soon-1.svg'
    },
    {
        id: 'coming-soon-2',
        name: 'Coming Soon',
        author: 'Gurika',
        description: 'Reserved slot.',
        status: 'coming-soon',
        icon: 'fa-hourglass-half',
        imageName: 'coming-soon-2.svg'
    }
];

// Files/folders copied from modpack_files/<id>/ → instance root on each launch
const SYNC_TARGETS = [
    'mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks',
    'saves', 'kubejs', 'customnpcs', 'tacz', 'pointblank', 'berezka_plugins',
    'fancymenu_data', 'moonlight-global-data-packs',
    'manifest.json', 'modlist.html',
    'options.txt', 'optionsof.txt', 'optionsshaders.txt'
];

const DEFAULT_CONFIG = {
    username: 'KaliPlayer',
    settings: {
        memoryMax: 6,
        memoryMin: 2,
        resolutionWidth: 1280,
        resolutionHeight: 720,
        fullscreen: false,
        closeBehavior: 'hide'
    }
};

// ─── App State ─────────────────────────────────────────────────────────────────

let win = null;
let activeProcess = null;
let updaterReady = false;

// ─── Paths ─────────────────────────────────────────────────────────────────────

const dataRoot = () => path.join(app.getPath('userData'), '.kalilauncher');
const mcRoot   = () => {
    const root = path.join(dataRoot(), 'runtime', '.minecraft');
    ensureDir(root);
    ensureDir(path.join(root, 'versions'));
    ensureDir(path.join(root, 'libraries'));
    ensureDir(path.join(root, 'assets', 'indexes'));
    ensureDir(path.join(root, 'assets', 'objects'));
    ensureLauncherProfiles(root);
    return root;
};
const libraryRoot  = () => path.join(dataRoot(), 'modpacks');
const instancesRoot = () => path.join(dataRoot(), 'instances', 'modpacks');
const profileRoot  = () => path.join(dataRoot(), 'profile');
const skinPath     = () => path.join(profileRoot(), 'skin.png');
const configPath   = () => path.join(app.getPath('userData'), 'launcher-config.json');
const packFilesRoot = () =>
    path.join(__dirname, 'modpack_files').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
const coverRoot    = () =>
    path.join(__dirname, 'assets', 'modpack-covers').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');

// ─── Utilities ─────────────────────────────────────────────────────────────────

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function sanitize(v) {
    return String(v).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

function ensureLauncherProfiles(root) {
    const now = new Date().toISOString();
    const payload = {
        profiles: { KaliLauncher: { created: now, icon: 'Grass', lastUsed: now, lastVersionId: 'latest-release', name: 'KaliLauncher', type: 'custom' } },
        selectedProfile: 'KaliLauncher',
        clientToken: '00000000-0000-0000-0000-000000000000',
        authenticationDatabase: {},
        version: 3
    };
    for (const name of ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json']) {
        const p = path.join(root, name);
        if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(payload, null, 2));
    }
    const acc = path.join(root, 'launcher_accounts.json');
    if (!fs.existsSync(acc)) fs.writeFileSync(acc, JSON.stringify({ accounts: {}, activeAccountLocalId: null }, null, 2));
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                resolve(fetchUrl(res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString()));
                return;
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
    });
}

async function fetchJson(url)  { return JSON.parse((await fetchUrl(url)).toString('utf8')); }
async function fetchText(url)  { return (await fetchUrl(url)).toString('utf8'); }
async function downloadFile(url, dest) {
    const data = await fetchUrl(url);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, data);
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function sendMsg(channel, data) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}
function status(msg) {
    console.log('[KL]', msg);
    sendMsg('status', msg);
}

// ─── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
    try {
        if (fs.existsSync(configPath())) {
            const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
            return {
                username: raw.username || DEFAULT_CONFIG.username,
                settings: { ...DEFAULT_CONFIG.settings, ...(raw.settings || {}) }
            };
        }
    } catch {}
    return { ...DEFAULT_CONFIG, settings: { ...DEFAULT_CONFIG.settings } };
}

function saveConfig(cfg) {
    const merged = {
        username: cfg.username || DEFAULT_CONFIG.username,
        settings: { ...DEFAULT_CONFIG.settings, ...(cfg.settings || {}) }
    };
    ensureDir(path.dirname(configPath()));
    fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2));
    return merged;
}

// ─── Java ──────────────────────────────────────────────────────────────────────

// Reads the authoritative Java requirement straight from Mojang's version JSON
// (the "javaVersion.majorVersion" field) instead of guessing from the version
// number. This handles any current or future major (17, 21, 25, ...) without
// needing code changes. Falls back to a heuristic only for legacy versions
// that predate that field (anything before ~1.17).
function resolveJavaMajor(root, mcVersion, loader = 'release') {
    try {
        const vPath = path.join(root, 'versions', mcVersion, `${mcVersion}.json`);
        if (fs.existsSync(vPath)) {
            const required = readJson(vPath)?.javaVersion?.majorVersion;
            if (required) return required;
        }
    } catch {}
    const m = String(mcVersion || '').match(/^1\.(\d+)/);
    if (!m) return 21; // unknown/future version format with no JSON yet -> assume a modern JVM
    const minor = Number(m[1]);
    if (loader === 'forge' && minor <= 16) return 8;
    if (minor >= 17) return 17;
    return 8;
}

function listInstalledJavas() {
    const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LocalAppData, process.env.APPDATA, process.env.JAVA_HOME ? path.dirname(path.dirname(process.env.JAVA_HOME)) : null]
        .filter(Boolean)
        .flatMap(b => ['Java', 'Eclipse Adoptium', 'Temurin', 'Amazon Corretto', 'Microsoft', 'Zulu', 'BellSoft', 'Programs/Eclipse Adoptium', 'Programs/Java'].map(s => path.join(b, s)));

    const found = [];
    for (const base of bases) {
        if (!fs.existsSync(base)) continue;
        let entries = [];
        try {
            entries = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
        } catch { continue; }
        for (const name of entries) {
            const exe = path.join(base, name, 'bin', 'java.exe');
            if (!fs.existsSync(exe)) continue;
            let major = null;
            let m = name.match(/jdk-?(\d+)/i) || name.match(/jre-?(\d+)/i) || name.match(/corretto-?(\d+)/i) || name.match(/zulu-?(\d+)/i);
            if (m) major = Number(m[1]);
            if (!major && /1\.8\.0/.test(name)) major = 8;
            if (!major) { m = name.match(/(\d+)/); if (m) major = Number(m[1]); }
            if (major) found.push({ major, exe });
        }
    }
    return found;
}

function findJava(requiredMajor) {
    if (!requiredMajor) return 'java';

    for (const envVar of [`JAVA${requiredMajor}_HOME`, `JDK${requiredMajor}_HOME`]) {
        if (process.env[envVar]) {
            const exe = path.join(process.env[envVar], 'bin', 'java.exe');
            if (fs.existsSync(exe)) return exe;
        }
    }

    // Pick the smallest installed major that's >= what's required — a newer
    // JVM can always run older bytecode, but never the reverse.
    const usable = listInstalledJavas()
        .filter(j => j.major >= requiredMajor)
        .sort((a, b) => a.major - b.major);
    if (usable.length) return usable[0].exe;

    if (process.env.JAVA_HOME) {
        const exe = path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
        if (fs.existsSync(exe)) return exe;
    }

    return null; // not found on this PC — caller decides whether to auto-download
}

// ─── Auto-download Java (Adoptium/Temurin) ─────────────────────────────────────
// Mirrors what the official launcher does: if no suitable local Java is found,
// fetch a portable JRE for the exact major version needed and keep it inside
// the launcher's own data folder, so the user never has to install anything by hand.

function bundledJavaDir(major) {
    return path.join(dataRoot(), 'runtimes', `java-${major}`);
}

function findBundledJava(major) {
    const root = bundledJavaDir(major);
    if (!fs.existsSync(root)) return null;
    const direct = path.join(root, 'bin', 'java.exe');
    if (fs.existsSync(direct)) return direct;
    try {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const exe = path.join(root, entry.name, 'bin', 'java.exe');
            if (fs.existsSync(exe)) return exe;
        }
    } catch {}
    return null;
}

function adoptiumPlatform() {
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'darwin') return 'mac';
    return 'linux';
}

function adoptiumArch() {
    return { x64: 'x64', arm64: 'aarch64', ia32: 'x86-32' }[process.arch] || 'x64';
}

async function downloadAndInstallJava(major) {
    const platform = adoptiumPlatform();
    const arch = adoptiumArch();
    const isWin = platform === 'windows';
    const ext = isWin ? 'zip' : 'tar.gz';
    const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${platform}/${arch}/jre/hotspot/normal/eclipse`;

    status(`Downloading Java ${major} runtime...`);
    const archivePath = path.join(app.getPath('temp'), `kali-java-${major}.${ext}`);
    try {
        await downloadFile(url, archivePath);
    } catch (err) {
        throw new Error(`Could not auto-download Java ${major} (${err.message}). Install it manually from https://adoptium.net/temurin/releases/?version=${major}`);
    }

    const destRoot = bundledJavaDir(major);
    rmIfExists(destRoot);
    ensureDir(destRoot);
    status(`Installing Java ${major} runtime...`);

    if (isWin) {
        const psCmd = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destRoot.replace(/'/g, "''")}' -Force`;
        const result = await runCmd('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd]);
        if (result.code !== 0) throw new Error(`Failed to extract the downloaded Java ${major} runtime.`);
    } else {
        ensureDir(destRoot);
        const result = await runCmd('tar', ['-xzf', archivePath, '-C', destRoot]);
        if (result.code !== 0) throw new Error(`Failed to extract the downloaded Java ${major} runtime.`);
    }

    const exe = findBundledJava(major);
    if (!exe) throw new Error(`Java ${major} runtime downloaded but its java executable could not be located afterward.`);
    return exe;
}

async function ensureJava(requiredMajor) {
    if (!requiredMajor) return 'java';

    const onSystem = findJava(requiredMajor);
    if (onSystem) return onSystem;

    const bundled = findBundledJava(requiredMajor);
    if (bundled) return bundled;

    return downloadAndInstallJava(requiredMajor);
}

// ─── Modpack Files ─────────────────────────────────────────────────────────────

function getPackSourceRoot(packId) {
    const def = GURIKA_PACKS.find(p => p.id === sanitize(packId));
    return path.join(packFilesRoot(), def?.id || sanitize(packId));
}

function getPackCoverPath(def) {
    return path.join(coverRoot(), def?.imageName || `${sanitize(def?.id || 'pack')}.svg`);
}

function countMods(root) {
    const modsDir = path.join(root, 'mods');
    if (!fs.existsSync(modsDir)) return 0;
    return fs.readdirSync(modsDir).filter(f => f.endsWith('.jar')).length;
}

function getPackStats(root) {
    return {
        modCount: countMods(root),
        hasConfig: fs.existsSync(path.join(root, 'config')),
        hasShaders: fs.existsSync(path.join(root, 'shaderpacks'))
    };
}

function placeholderSvg(name, subtitle = '') {
    const s = String(name).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
    const sub = String(subtitle).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0c0c10"/><stop offset="1" stop-color="#1a1a2e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <circle cx="900" cy="200" r="200" fill="#4ade80" opacity="0.08"/>
  <text x="60" y="100" fill="#4ade80" font-family="Arial" font-size="22" font-weight="700" letter-spacing="6">GURIKA RESOURCES</text>
  <text x="60" y="340" fill="#f4f4f8" font-family="Arial" font-size="80" font-weight="800">${s}</text>
  <text x="64" y="410" fill="#888899" font-family="Arial" font-size="32">${sub}</text>
</svg>`;
}

function ensureGurikaDirs() {
    ensureDir(packFilesRoot());
    ensureDir(coverRoot());
    for (const def of GURIKA_PACKS) {
        const src = getPackSourceRoot(def.id);
        ensureDir(src);
        const cover = getPackCoverPath(def);
        if (!fs.existsSync(cover)) {
            const sub = def.loader === 'fabric' ? `Fabric ${def.mcVersion || ''}` : def.loader === 'forge' ? `Forge ${def.mcVersion || ''}` : 'Coming Soon';
            fs.writeFileSync(cover, placeholderSvg(def.name, sub), 'utf8');
        }
    }
}

// ─── Installed Modpacks ────────────────────────────────────────────────────────

function readPackManifest(root) {
    const names = ['kalilauncher-pack.json', 'pack.json', 'manifest.json'];
    for (const n of names) {
        const p = path.join(root, n);
        if (!fs.existsSync(p)) continue;
        try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    }
    return null;
}

function writePackManifest(root, data) {
    ensureDir(root);
    fs.writeFileSync(path.join(root, 'kalilauncher-pack.json'), JSON.stringify(data, null, 2));
}

function listInstalled() {
    const root = libraryRoot();
    ensureDir(root);
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => {
            const packRoot = path.join(root, e.name);
            const manifest = readPackManifest(packRoot) || {};
            return {
                id: e.name,
                name: manifest.name || e.name,
                author: manifest.author || 'Gurika',
                description: manifest.description || '',
                loader: manifest.loader || 'forge',
                mcVersion: manifest.mcVersion || '1.20.1',
                forgeBuild: manifest.forgeBuild || '',
                versionId: manifest.versionId || '',
                fabricVersion: manifest.fabricVersion || '',
                status: 'installed',
                icon: manifest.icon || 'fa-cube',
                image: manifest.image || manifest.imageName || '',
                rootPath: packRoot,
                ...getPackStats(packRoot)
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

function listSourcePacks() {
    ensureGurikaDirs();
    return GURIKA_PACKS.map((def, i) => {
        const src = getPackSourceRoot(def.id);
        const installedRoot = path.join(libraryRoot(), sanitize(def.id));
        const installed = fs.existsSync(installedRoot);
        return {
            ...def,
            rootPath: src,
            coverPath: getPackCoverPath(def),
            installed,
            installedPath: installed ? installedRoot : null,
            order: i,
            ...getPackStats(src)
        };
    });
}

function copyDir(from, to) {
    if (!fs.existsSync(from)) return;
    ensureDir(to);
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const s = path.join(from, entry.name);
        const d = path.join(to, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

function copyIfExists(src, dst) {
    if (!fs.existsSync(src)) return;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) copyDir(src, dst);
    else { ensureDir(path.dirname(dst)); fs.copyFileSync(src, dst); }
}

function rmIfExists(p) {
    if (!fs.existsSync(p)) return;
    try {
        fs.rmSync(p, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 });
    } catch (err) {
        // Windows sometimes keeps a transient lock (AV scan, recently closed handle).
        // Retry a few times with a short pause before giving up.
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const start = Date.now();
                while (Date.now() - start < 250) { /* brief busy-wait */ }
                fs.rmSync(p, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 });
                return;
            } catch {}
        }
        console.warn('[KL] Could not fully remove (continuing):', p);
    }
}

function syncSourceToInstance(sourceRoot, instanceRoot) {
    ensureDir(instanceRoot);
    for (const target of SYNC_TARGETS) {
        const src = path.join(sourceRoot, target);
        const dst = path.join(instanceRoot, target);
        rmIfExists(dst);
        copyIfExists(src, dst);
    }
    // Inject skin resource pack if custom skin exists
    injectSkinPack(instanceRoot);
}

// ─── Skin Resource Pack Injection ─────────────────────────────────────────────

function injectSkinPack(instanceRoot) {
    const skin = skinPath();
    if (!fs.existsSync(skin)) return;
    const packDir = path.join(instanceRoot, 'resourcepacks', 'KaliSkin');
    const texDir = path.join(packDir, 'assets', 'minecraft', 'textures', 'entity', 'player', 'wide');
    ensureDir(texDir);
    fs.copyFileSync(skin, path.join(texDir, 'steve.png'));
    fs.copyFileSync(skin, path.join(texDir, 'alex.png'));
    fs.writeFileSync(path.join(packDir, 'pack.mcmeta'),
        JSON.stringify({ pack: { pack_format: 15, description: 'KaliLauncher skin' } }, null, 2));
    // Add to options.txt if present
    const optPath = path.join(instanceRoot, 'options.txt');
    if (fs.existsSync(optPath)) {
        let opts = fs.readFileSync(optPath, 'utf8');
        if (!opts.includes('KaliSkin')) {
            opts = opts.replace(/(resourcePacks:\[.*?)(\])/, (_, a, b) =>
                a.endsWith('[') ? `${a}"KaliSkin"${b}` : `${a},"KaliSkin"${b}`);
            if (!opts.includes('resourcePacks:')) {
                opts += '\nresourcePacks:["vanilla","KaliSkin"]\n';
            }
            fs.writeFileSync(optPath, opts, 'utf8');
        }
    }
}

function installGUrikaPack(packId) {
    const def = GURIKA_PACKS.find(p => p.id === sanitize(packId));
    if (!def) throw new Error(`Pack "${packId}" not found in definitions.`);
    if (def.status !== 'available') throw new Error(`"${def.name}" is not available yet.`);

    const src = getPackSourceRoot(def.id);
    const dst = path.join(libraryRoot(), sanitize(def.id));
    rmIfExists(dst);
    copyDir(src, dst);
    ensureDir(dst);
    writePackManifest(dst, {
        id: def.id,
        name: def.name,
        author: def.author,
        description: def.description,
        loader: def.loader || 'forge',
        mcVersion: def.mcVersion,
        forgeBuild: def.forgeBuild || '',
        versionId: def.versionId || '',
        fabricVersion: def.fabricVersion || '',
        icon: def.icon,
        imageName: def.imageName,
        installedAt: new Date().toISOString()
    });
    return { ...def, rootPath: dst, ...getPackStats(dst) };
}

function deleteInstalledPack(packId) {
    const id = sanitize(packId);
    const root = path.join(libraryRoot(), id);
    if (!fs.existsSync(root)) return null;
    const manifest = readPackManifest(root) || { id };
    rmIfExists(root);
    rmIfExists(path.join(instancesRoot(), id));
    return manifest;
}

// ─── Minecraft / Forge / Fabric ────────────────────────────────────────────────

async function ensureVanilla(root, version) {
    const vDir = path.join(root, 'versions', version);
    const vJson = path.join(vDir, `${version}.json`);
    if (!fs.existsSync(vJson)) {
        status(`Downloading ${version} metadata...`);
        const manifest = await fetchJson(MOJANG_VERSION_MANIFEST);
        const entry = (manifest.versions || []).find(v => v.id === version);
        if (!entry) throw new Error(`Minecraft ${version} not found in Mojang manifest.`);
        const data = await fetchJson(entry.url);
        ensureDir(vDir);
        fs.writeFileSync(vJson, JSON.stringify(data, null, 2));
        const clientJar = path.join(vDir, `${version}.jar`);
        if (data.downloads?.client?.url && !fs.existsSync(clientJar)) {
            status(`Downloading ${version} client...`);
            await downloadFile(data.downloads.client.url, clientJar);
        }
        const idx = data.assetIndex;
        if (idx?.url) {
            const idxPath = path.join(root, 'assets', 'indexes', `${idx.id}.json`);
            if (!fs.existsSync(idxPath)) {
                status(`Downloading ${version} assets index...`);
                await downloadFile(idx.url, idxPath);
            }
        }
    }
}

function findInstalledVersion(root, loader, mcVersion, exactBuild = null) {
    const versionsDir = path.join(root, 'versions');
    if (!fs.existsSync(versionsDir)) return null;
    const mc = String(mcVersion).toLowerCase();
    const candidates = fs.readdirSync(versionsDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .filter(id => {
            const low = id.toLowerCase();
            if (!low.includes(mc)) return false;
            if (loader === 'forge' && !low.includes('forge')) return false;
            if (loader === 'fabric' && !low.includes('fabric')) return false;
            return fs.existsSync(path.join(versionsDir, id, `${id}.json`));
        });
    // If exact build requested, prefer that
    if (exactBuild) {
        const exact = candidates.find(id => id.toLowerCase().includes(exactBuild.toLowerCase().split('-').pop()));
        if (exact) return exact;
    }
    return candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] || null;
}

async function ensureForge(root, mcVersion, forgeBuild, preferredVersionId) {
    // Check if exact preferred version is installed and usable
    if (preferredVersionId) {
        const vDir = path.join(root, 'versions', preferredVersionId);
        if (fs.existsSync(path.join(vDir, `${preferredVersionId}.json`))) {
            return preferredVersionId; // Already installed exactly what we need
        }
    }
    // Check if any forge for this mc+build is installed
    const existing = findInstalledVersion(root, 'forge', mcVersion, forgeBuild);
    if (existing && existing === preferredVersionId) return existing;
    // Need to install
    await ensureVanilla(root, mcVersion);
    const build = forgeBuild || `${mcVersion}-47.4.10`;
    const installerUrl = `${FORGE_MAVEN}/${build}/forge-${build}-installer.jar`;
    const installerName = `forge-${build}-installer.jar`;
    const installerPath = path.join(app.getPath('temp'), 'kali-installers', installerName);
    if (!fs.existsSync(installerPath)) {
        status(`Downloading Forge ${build} installer...`);
        await downloadFile(installerUrl, installerPath);
    }
    const javaBin = await ensureJava(resolveJavaMajor(root, mcVersion, 'forge'));
    status(`Installing Forge ${build}...`);
    const env = { ...process.env, APPDATA: path.dirname(root), MINECRAFT_HOME: root };
    const result = await runCmd(javaBin, ['-jar', installerPath, '--installClient', root], { env, cwd: path.dirname(installerPath) });
    if (result.code !== 0) throw new Error(`Forge installer failed with code ${result.code}`);
    const installed = preferredVersionId && fs.existsSync(path.join(root, 'versions', preferredVersionId, `${preferredVersionId}.json`))
        ? preferredVersionId
        : findInstalledVersion(root, 'forge', mcVersion);
    if (!installed) throw new Error(`Forge ${build} installed but version not found.`);
    return installed;
}

async function ensureFabric(root, mcVersion) {
    const existing = findInstalledVersion(root, 'fabric', mcVersion);
    if (existing) return existing;
    await ensureVanilla(root, mcVersion);
    status(`Getting Fabric loader for ${mcVersion}...`);
    const loaders = await fetchJson(`${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mcVersion)}`);
    const chosen = loaders.find(e => e.loader?.stable) || loaders[0];
    if (!chosen?.loader?.version) throw new Error(`No Fabric loader for ${mcVersion}`);
    const loaderVersion = chosen.loader.version;
    const profileJson = await fetchJson(`${FABRIC_META}/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`);
    const versionId = profileJson.id || `fabric-loader-${loaderVersion}-${mcVersion}`;
    const vDir = path.join(root, 'versions', versionId);
    ensureDir(vDir);
    fs.writeFileSync(path.join(vDir, `${versionId}.json`), JSON.stringify(profileJson, null, 2));
    return versionId;
}

function runCmd(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { cwd: opts.cwd, env: opts.env || process.env, windowsHide: true });
        let stdout = '', stderr = '';
        p.stdout?.on('data', c => { stdout += c; console.log('[CMD]', c.toString().trim()); });
        p.stderr?.on('data', c => { stderr += c; console.log('[CMD]', c.toString().trim()); });
        p.on('error', reject);
        p.on('close', code => resolve({ code, stdout, stderr }));
    });
}

// ─── Launch ────────────────────────────────────────────────────────────────────

function buildAuth(username) {
    return {
        access_token: '0',
        client_token: '0',
        uuid: '00000000-0000-0000-0000-000000000000',
        name: username,
        user_properties: '{}',
        meta: { type: 'mojang', xuid: '0', clientId: '0' }
    };
}

// Low-level Forge launch using the installed version JSON directly
async function launchForge(versionId, instanceRoot, username, settings, root, mcVersion) {
    if (!fs.existsSync(path.join(root, 'versions', versionId, `${versionId}.json`))) {
        throw new Error(`Forge version JSON missing for ${versionId}. Reinstall this modpack and try again.`);
    }

    const requiredJava = resolveJavaMajor(root, mcVersion || versionId, 'forge');
    const javaBin = await ensureJava(requiredJava);

    const client = new Client();
    const opts = {
        authorization: buildAuth(username),
        root,
        javaPath: javaBin,
        version: { number: mcVersion || versionId, type: 'release', custom: versionId },
        memory: {
            max: `${Math.max(2, Number(settings.memoryMax) || 6)}G`,
            min: `${Math.max(1, Number(settings.memoryMin) || 2)}G`
        },
        window: {
            width: Number(settings.resolutionWidth) || 1280,
            height: Number(settings.resolutionHeight) || 720,
            fullscreen: Boolean(settings.fullscreen)
        },
        overrides: { gameDirectory: instanceRoot }
    };

    client.on('debug', d => { console.log('[MCLC][debug]', d); sendMsg('game-log', d); });
    client.on('data', d => { console.log('[MCLC][data]', d); sendMsg('game-log', d); });
    client.on('progress', e => status(`${e.type}: ${e.task} (${e.cur || 0}/${e.total || 0})`));
    client.on('close', code => {
        activeProcess = null;
        showLauncher();
        if (code !== 0) sendMsg('launch-error', `Game closed unexpectedly (exit code ${code}). If this keeps happening, delete this modpack's instance folder and relaunch to force a clean Forge reinstall.`);
        sendMsg('game-closed', code);
    });
    client.on('error', err => { showLauncher(); sendMsg('launch-error', err?.message || String(err)); });

    hideLauncher();
    client.launch(opts);
}

async function launchFabric(versionId, instanceRoot, username, settings, root, mcVersion = '1.20.1') {
    const client = new Client();
    const javaBin = await ensureJava(resolveJavaMajor(root, mcVersion, 'fabric'));
    const opts = {
        authorization: buildAuth(username),
        root,
        javaPath: javaBin,
        version: { number: mcVersion, type: 'release', custom: versionId },
        memory: { max: `${Math.max(2, Number(settings.memoryMax) || 6)}G`, min: `${Math.max(1, Number(settings.memoryMin) || 2)}G` },
        window: { width: Number(settings.resolutionWidth) || 1280, height: Number(settings.resolutionHeight) || 720, fullscreen: Boolean(settings.fullscreen) },
        overrides: { gameDirectory: instanceRoot }
    };
    client.on('debug', d => { console.log('[MCLC][debug]', d); sendMsg('game-log', d); });
    client.on('data', d => { console.log('[MCLC][data]', d); sendMsg('game-log', d); });
    client.on('progress', e => status(`${e.type}: ${e.task} (${e.cur || 0}/${e.total || 0})`));
    client.on('close', code => {
        activeProcess = null;
        showLauncher();
        if (code !== 0) sendMsg('launch-error', `Game closed unexpectedly (exit code ${code}). Check that Java ${resolveJavaMajor(root, mcVersion, 'fabric')}+ is installed and that you have a stable internet connection for asset downloads.`);
        sendMsg('game-closed', code);
    });
    client.on('error', err => { showLauncher(); sendMsg('launch-error', err?.message || String(err)); });
    hideLauncher();
    client.launch(opts);
}

async function launchVanilla(mcVersion, instanceRoot, username, settings, root) {
    const client = new Client();
    const javaBin = await ensureJava(resolveJavaMajor(root, mcVersion, 'release'));
    const opts = {
        authorization: buildAuth(username),
        root,
        javaPath: javaBin,
        version: { number: mcVersion, type: 'release' },
        memory: { max: `${Math.max(2, Number(settings.memoryMax) || 4)}G`, min: `${Math.max(1, Number(settings.memoryMin) || 2)}G` },
        window: { width: Number(settings.resolutionWidth) || 1280, height: Number(settings.resolutionHeight) || 720, fullscreen: Boolean(settings.fullscreen) },
        overrides: { gameDirectory: instanceRoot }
    };
    client.on('debug', d => { console.log('[MCLC][debug]', d); sendMsg('game-log', d); });
    client.on('data', d => { console.log('[MCLC][data]', d); sendMsg('game-log', d); });
    client.on('progress', e => status(`${e.type}: ${e.task} (${e.cur || 0}/${e.total || 0})`));
    client.on('close', code => {
        activeProcess = null;
        showLauncher();
        if (code !== 0) sendMsg('launch-error', `Game closed unexpectedly (exit code ${code}). Check that Java ${resolveJavaMajor(root, mcVersion, 'release')}+ is installed and that you have a stable internet connection for asset downloads.`);
        sendMsg('game-closed', code);
    });
    client.on('error', err => { showLauncher(); sendMsg('launch-error', err?.message || String(err)); });
    hideLauncher();
    client.launch(opts);
}

let cachedReleaseVersions = null;
async function getReleaseVersions() {
    if (cachedReleaseVersions) return cachedReleaseVersions;
    const manifest = await fetchJson(MOJANG_VERSION_MANIFEST);
    const releases = (manifest.versions || [])
        .filter(v => v.type === 'release')
        .sort((a, b) => new Date(b.releaseTime) - new Date(a.releaseTime))
        .map(v => v.id);
    cachedReleaseVersions = releases;
    return releases;
}

async function getForgeBuildFor(mcVersion) {
    const promos = await fetchJson(`${FORGE_FILES}/promotions_slim.json`);
    const build = promos?.promos?.[`${mcVersion}-recommended`] || promos?.promos?.[`${mcVersion}-latest`];
    if (!build) throw new Error(`Forge has no build published for Minecraft ${mcVersion}.`);
    return `${mcVersion}-${build}`;
}

// ─── Window ────────────────────────────────────────────────────────────────────

function hideLauncher() {
    if (!win || win.isDestroyed()) return;
    const behavior = loadConfig().settings.closeBehavior;
    if (behavior === 'stay') return;
    if (behavior === 'minimize') { win.minimize(); return; }
    win.hide();
}

function showLauncher() {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function createWindow() {
    win = new BrowserWindow({
        width: 1280, height: 800,
        minWidth: 960, minHeight: 640,
        backgroundColor: '#0c0c10',
        title: 'KaliLauncher',
        icon: path.join(__dirname, 'build', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    win.setMenuBarVisibility(false);
    win.loadFile('index.html');
    win.webContents.once('did-finish-load', () => {
        setTimeout(() => setupAutoUpdater(), 2000);
    });
}

// ─── Auto Updater ──────────────────────────────────────────────────────────────

function setupAutoUpdater() {
    if (updaterReady) return;
    const cfgPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app-update.yml')
        : path.join(app.getAppPath(), 'dev-app-update.yml');
    if (!fs.existsSync(cfgPath)) return;
    updaterReady = true;
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.logger = log;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    const send = (type, msg, extra = {}) => { console.log('[Updater]', msg); sendMsg('updater', { type, msg, ...extra }); };
    autoUpdater.on('checking-for-update', () => send('checking', 'Checking for updates...'));
    autoUpdater.on('update-available', i => send('available', `Update ${i?.version} found, downloading...`, { version: i?.version }));
    autoUpdater.on('update-not-available', () => send('none', 'Up to date'));
    autoUpdater.on('error', e => send('error', e?.message?.includes('404') ? 'No update found' : (e?.message || 'Update error')));
    autoUpdater.on('download-progress', p => send('progress', `Downloading update ${Math.round(p.percent || 0)}%`, { percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', i => {
        send('ready', `Update ${i?.version} ready to install`, {
            version: i?.version || '',
            releaseNotes: typeof i?.releaseNotes === 'string' ? i.releaseNotes : ''
        });
    });
    autoUpdater.checkForUpdates().catch(e => console.error('[Updater]', e));
}

ipcMain.handle('install-update', () => {
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
});

// ─── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (_, cfg) => saveConfig(cfg));

ipcMain.handle('get-hub', () => ({
    library: listInstalled(),
    resources: listSourcePacks(),
    packFilesRoot: packFilesRoot(),
    libraryRoot: libraryRoot()
}));

ipcMain.handle('install-pack', async (_, packId) => {
    try {
        const pack = installGUrikaPack(packId);
        return { ok: true, pack };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('delete-pack', async (_, packId) => {
    try {
        const pack = deleteInstalledPack(packId);
        return { ok: true, pack };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('launch-pack', async (_, args) => {
    const { packId, username, settings } = args;
    try {
        const pack = listInstalled().find(p => p.id === sanitize(packId));
        if (!pack) throw new Error(`Modpack "${packId}" not installed.`);

        const loader = String(pack.loader || 'forge').toLowerCase();
        const root = mcRoot();
        const instanceRoot = path.join(instancesRoot(), sanitize(packId));
        ensureDir(instanceRoot);

        // Sync source files to instance
        syncSourceToInstance(pack.rootPath, instanceRoot);

        if (loader === 'fabric') {
            status(`Setting up Fabric ${pack.mcVersion}...`);
            const vId = await ensureFabric(root, pack.mcVersion || '1.20.1');
            status(`Launching ${pack.name}...`);
            await launchFabric(vId, instanceRoot, username, settings, root, pack.mcVersion || '1.20.1');
        } else {
            // Forge
            if (!pack.forgeBuild) throw new Error('This pack has no forgeBuild set in its manifest.');
            status(`Setting up Forge ${pack.versionId || pack.forgeBuild}...`);
            const vId = await ensureForge(root, pack.mcVersion || '1.20.1', pack.forgeBuild, pack.versionId);
            status(`Launching ${pack.name}...`);
            await launchForge(vId, instanceRoot, username, settings, root, pack.mcVersion || '1.20.1');
        }
        return { ok: true };
    } catch (e) {
        console.error('[Launch]', e);
        showLauncher();
        sendMsg('launch-error', e.message);
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('get-mc-versions', async () => {
    try {
        const versions = await getReleaseVersions();
        return { ok: true, versions };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('quick-launch', async (_, args) => {
    const { loader, mcVersion, username, settings } = args;
    try {
        if (!mcVersion) throw new Error('Pick a Minecraft version first.');
        const root = mcRoot();
        const id = `${sanitize(loader)}-${sanitize(mcVersion)}`;
        const instanceRoot = path.join(dataRoot(), 'quickplay', id);
        ensureDir(instanceRoot);
        injectSkinPack(instanceRoot);

        if (loader === 'vanilla') {
            status(`Setting up Minecraft ${mcVersion}...`);
            await ensureVanilla(root, mcVersion);
            status(`Launching Minecraft ${mcVersion}...`);
            await launchVanilla(mcVersion, instanceRoot, username, settings, root);
        } else if (loader === 'fabric') {
            status(`Setting up Fabric ${mcVersion}...`);
            const vId = await ensureFabric(root, mcVersion);
            status(`Launching Fabric ${mcVersion}...`);
            await launchFabric(vId, instanceRoot, username, settings, root, mcVersion);
        } else if (loader === 'forge') {
            status(`Finding Forge build for ${mcVersion}...`);
            const build = await getForgeBuildFor(mcVersion);
            status(`Setting up Forge ${build}...`);
            const vId = await ensureForge(root, mcVersion, build, `${mcVersion}-forge-${build.split('-').pop()}`);
            status(`Launching Forge ${mcVersion}...`);
            await launchForge(vId, instanceRoot, username, settings, root, mcVersion);
        } else {
            throw new Error(`Unknown loader "${loader}".`);
        }
        return { ok: true };
    } catch (e) {
        console.error('[QuickPlay]', e);
        showLauncher();
        sendMsg('launch-error', e.message);
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('select-skin', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose skin PNG', properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (result.canceled || !result.filePaths?.length) return { ok: false };
    ensureDir(profileRoot());
    fs.copyFileSync(result.filePaths[0], skinPath());
    return { ok: true, hasSkin: true };
});

ipcMain.handle('clear-skin', () => {
    if (fs.existsSync(skinPath())) fs.unlinkSync(skinPath());
    return { ok: true, hasSkin: false };
});

ipcMain.handle('get-profile', () => ({
    hasSkin: fs.existsSync(skinPath()),
    skinPath: fs.existsSync(skinPath()) ? skinPath() : null
}));

ipcMain.handle('open-folder', async (_, key, payload = {}) => {
    let target;
    if (key === 'packSource')   target = getPackSourceRoot(payload.packId || '');
    else if (key === 'packInstalled') target = path.join(libraryRoot(), sanitize(payload.packId || ''));
    else if (key === 'library')  target = libraryRoot();
    else if (key === 'packFiles') target = packFilesRoot();
    else if (key === 'mcRoot')   target = mcRoot();
    else target = dataRoot();
    ensureDir(target);
    const err = await shell.openPath(target);
    return err ? { ok: false, error: err } : { ok: true };
});

ipcMain.handle('check-updates', async () => {
    try {
        setupAutoUpdater();
        await autoUpdater.checkForUpdates();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('open-java-download', async (_, v) => {
    await shell.openExternal(`https://adoptium.net/temurin/releases/?version=${v || '17'}`);
});

// ─── App ───────────────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
