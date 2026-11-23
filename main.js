'use strict';
/* KaliLauncher: მთავარი პროცესი */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fsp = require('fs').promises;
const U = require('./util');
const game = require('./game');
const packs = require('./modpacks');
const { P } = U;

let win = null;
let config = null;
let configFile = null;

const DEFAULTS = {
  playerName: 'Player',
  skin: '',
  ram: 4096,
  javaPath: '',
  extraJvm: '',
  snapshots: false,
  keepOpen: true,
  language: 'en',
  width: 0,
  height: 0,
  lastPlay: { loader: 'vanilla', mc: '', loaderVersion: '' },
};

/* ---------- კონფიგი ---------- */

async function loadConfig() {
  configFile = path.join(app.getPath('userData'), 'config.json');
  config = { ...DEFAULTS, ...((await U.readJson(configFile)) || {}) };
  config.lastPlay = { ...DEFAULTS.lastPlay, ...(config.lastPlay || {}) };
  return config;
}
const saveConfig = () => U.writeJson(configFile, config);

/* ---------- ფანჯარა ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#090d16',
    title: 'KaliLauncher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send('evt:' + channel, payload); };
const restoreWindow = () => {
  if (win && !win.isDestroyed() && !win.isVisible()) {
    win.show();
    win.focus();
  }
};
const onProgress = (p) => {
  send('progress', p);
  if (p && p.exit !== undefined) restoreWindow();
};
const onLog = (line) => send('log', line);

/* ---------- ავტომატური განახლება (GitHub Releases) ---------- */

function setupAutoUpdater() {
  // dev რეჟიმში (npm start) განახლების შემოწმება არ გვჭირდება — მხოლოდ დაინსტალირებულ,
  // "packaged" build-ში აქვს აზრი.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => send('update', { state: 'checking' }));
  autoUpdater.on('update-not-available', () => send('update', { state: 'latest' }));
  autoUpdater.on('update-available', (info) => {
    send('update', { state: 'available', version: info.version });
    onLog(`New version found: ${info.version} — downloading in the background`);
  });
  autoUpdater.on('download-progress', (p) => {
    send('update', { state: 'downloading', percent: Math.round(p.percent) });
  });
  autoUpdater.on('error', (err) => {
    send('update', { state: 'error', message: err && err.message });
    onLog(`Could not check for updates: ${err && err.message}`);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    send('update', { state: 'ready', version: info.version });
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Ready',
      message: `KaliLauncher ${info.version} has been downloaded.`,
      detail: 'Restart the launcher to install the update.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch((e) => onLog(`Could not check for updates: ${e.message}`));
}

app.whenReady().then(async () => {
  U.setRoot(path.join(app.getPath('userData'), 'data'));
  packs.setSourceDir(
    app.isPackaged
      ? path.join(process.resourcesPath, 'modpack-files')
      : path.join(__dirname, 'modpack-files')
  );
  await loadConfig();
  await Promise.all([
    U.mkdirp(P.root()), U.mkdirp(P.instances()), U.mkdirp(P.cache()),
    U.mkdirp(P.optifine()), U.mkdirp(packs.sourceDir()),
  ]);
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });

/* ---------- IPC ---------- */

const handle = (channel, fn) => ipcMain.handle(channel, async (_e, arg) => {
  try { return { ok: true, data: await fn(arg) }; }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
});

handle('config:get', async () => ({
  ...config,
  skinData: config.skin ? await skinDataUrl(config.skin) : null,
  paths: {
    data: P.root(),
    instances: P.instances(),
    modpackFiles: packs.sourceDir(),
    optifine: P.optifine(),
  },
  platform: process.platform,
}));

handle('config:set', async (patch) => {
  config = { ...config, ...patch };
  await saveConfig();
  return true;
});

handle('app:version', async () => app.getVersion());
handle('update:install', () => { if (app.isPackaged) autoUpdater.quitAndInstall(); });
handle('versions:mc', async ({ loader, snapshots } = {}) => game.mcVersions(loader, snapshots === undefined ? config.snapshots : Boolean(snapshots)));
handle('versions:loader', async ({ loader, mc }) => game.loaderVersions(loader, mc));
handle('optifine:list', async () => (await game.listOptifineJars()).map((j) => j.name));

handle('launch', async (opts) => {
  const isPack = Boolean(opts.packId);
  let launchOpts;
  if (isPack) {
    const list = await packs.installed();
    const pack = list.find((p) => p.id === opts.packId);
    if (!pack) throw new Error('Modpack is not installed');
    launchOpts = {
      loader: pack.loader,
      mcVersion: pack.mcVersion,
      loaderVersion: pack.loaderVersion || '',
      gameDir: pack.dir,
      ram: pack.ram || config.ram,
    };
  } else {
    launchOpts = {
      loader: opts.loader,
      mcVersion: opts.mcVersion,
      loaderVersion: opts.loaderVersion || '',
      gameDir: P.instances(`${opts.loader}-${opts.mcVersion}`),
      ram: config.ram,
    };
    config.lastPlay = { loader: opts.loader, mc: opts.mcVersion, loaderVersion: opts.loaderVersion || '' };
    await saveConfig();
  }

  await U.mkdirp(launchOpts.gameDir);
  if (config.skin) {
    try {
      const skinReady = await applySkin(launchOpts.gameDir, launchOpts.loader, launchOpts.mcVersion, onLog);
      if (!skinReady) onLog('The local skin is prepared, but this profile needs a compatible Fabric, Forge, or NeoForge loader with CustomSkinLoader.');
    } catch (error) {
      onLog(`Could not prepare the custom skin: ${error.message}`);
    }
  }

  try {
    const result = await game.launch({
      ...launchOpts,
      playerName: config.playerName,
      javaPath: config.javaPath || '',
      extraJvm: config.extraJvm || '',
      width: config.width || 0,
      height: config.height || 0,
    }, { onProgress, onLog });

    if (isPack) await packs.markPlayed(opts.packId);
    // game.launch resolves only after the child process has passed its startup window.
    // Hide (not minimize) only while the game is genuinely still running.
    if (!config.keepOpen && game.isRunning() && win && !win.isDestroyed()) win.hide();
    return result;
  } catch (error) {
    restoreWindow();
    throw error;
  }
});

handle('launch:stop', async () => game.stop());
handle('launch:state', async () => game.isRunning());

handle('packs:available', () => packs.available());
handle('packs:installed', () => packs.installed());
handle('packs:install', async (id) => {
  const r = await packs.install(id, (stage, pct) => onProgress({ stage, pct }));
  onProgress({ stage: 'Modpack installed', pct: 1 });
  return r;
});
handle('packs:update', async (id) => {
  const r = await packs.update(id, (stage, pct) => onProgress({ stage, pct }));
  onProgress({ stage: `Updated ${r.changed} files`, pct: 1 });
  return r;
});
handle('packs:remove', (id) => packs.remove(id, { keepWorlds: true }));
handle('packs:scaffold', async (options = {}) => {
  const dir = await packs.scaffold(options);
  const openError = await shell.openPath(dir);
  if (openError) throw new Error(`The modpack was created, but its folder could not be opened: ${openError}`);
  return dir;
});

handle('open:path', async (target) => {
  const map = {
    data: P.root(),
    modpackFiles: packs.sourceDir(),
    optifine: P.optifine(),
    instances: P.instances(),
  };
  const dir = map[target] || target;
  await U.mkdirp(dir).catch(() => {});
  return shell.openPath(dir);
});

handle('pick:skin', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a Minecraft skin (64x64 or 64x32 PNG)',
    filters: [{ name: 'PNG image', extensions: ['png'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const source = res.filePaths[0];
  const png = await fsp.readFile(source);
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('The selected file is not a valid PNG image.');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== 64 || ![32, 64].includes(height)) throw new Error('Minecraft skins must be 64×64 or 64×32 PNG images.');
  if (png.length > 2 * 1024 * 1024) throw new Error('The skin image is too large.');
  const dest = path.join(app.getPath('userData'), 'skins', 'player.png');
  await U.copyFile(source, dest);
  config.skin = dest;
  await saveConfig();
  return { path: dest, data: await skinDataUrl(dest) };
});

handle('pick:java', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Choose Java', properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return null;
  config.javaPath = res.filePaths[0];
  await saveConfig();
  return config.javaPath;
});

handle('skin:clear', async () => {
  config.skin = '';
  await saveConfig();
  const dirs = await fsp.readdir(P.instances(), { withFileTypes: true }).catch(() => []);
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const gameDir = P.instances(entry.name);
    const cslDir = path.join(gameDir, 'CustomSkinLoader');
    const marker = await U.readJson(path.join(cslDir, 'KaliLauncherSkin.json'));
    if (!marker || !marker.username) continue;
    const skinFile = path.join(cslDir, 'LocalSkin', 'skins', `${marker.username}.png`);
    await fsp.rm(skinFile, { force: true }).catch(() => {});
    await fsp.rm(path.join(cslDir, 'KaliLauncherSkin.json'), { force: true }).catch(() => {});
  }
  return true;
});

/* ---------- Offline local skin support ---------- */

async function skinDataUrl(file) {
  try {
    const buf = await fsp.readFile(file);
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch { return null; }
}

async function ensureCustomSkinLoader(gameDir, mcVersion, loader, onLog = () => {}) {
  if (!['fabric', 'forge', 'neoforge'].includes(loader)) return false;
  const modsDir = path.join(gameDir, 'mods');
  await U.mkdirp(modsDir);
  const current = await fsp.readdir(modsDir).catch(() => []);
  const existingJars = current.filter((name) => /custom.?skin.?loader/i.test(name) && name.toLowerCase().endsWith('.jar'));
  const params = new URLSearchParams({
    game_versions: JSON.stringify([mcVersion]),
    loaders: JSON.stringify([loader]),
  });
  const url = `https://api.modrinth.com/v2/project/customskinloader/version?${params.toString()}`;
  const cacheKey = `customskinloader-${loader}-${mcVersion}.json`;
  let versions;
  try {
    versions = await U.cachedJson(url, cacheKey, 1000 * 60 * 60 * 24);
  } catch (error) {
    if (existingJars.length) {
      onLog(`Could not check CustomSkinLoader compatibility; keeping the existing JAR: ${error.message}`);
      return true;
    }
    throw error;
  }

  const compatible = Array.isArray(versions) ? versions : [];
  const release = compatible.find((v) => Array.isArray(v.files) && v.files.some((f) => f && f.primary && typeof f.filename === 'string' && f.filename.toLowerCase().endsWith('.jar')))
    || compatible.find((v) => Array.isArray(v.files) && v.files.some((f) => f && typeof f.filename === 'string' && f.filename.toLowerCase().endsWith('.jar')));
  if (!release) {
    onLog(`No compatible CustomSkinLoader release was found for Minecraft ${mcVersion} (${loader}).`);
    return false;
  }
  const file = release.files.find((f) => f && f.primary && typeof f.filename === 'string' && f.filename.toLowerCase().endsWith('.jar'))
    || release.files.find((f) => f && typeof f.filename === 'string' && f.filename.toLowerCase().endsWith('.jar'));
  if (!file || !file.url) return false;

  const destination = path.join(modsDir, path.basename(file.filename));
  onLog(`Checking CustomSkinLoader ${release.version_number || ''} for Minecraft ${mcVersion} (${loader})...`);
  const downloaded = await U.download(file.url, destination, { sha1: file.hashes && file.hashes.sha1 });
  if (downloaded) onLog('CustomSkinLoader downloaded.');
  // Remove stale copies only after the compatible copy is present.
  for (const name of existingJars) {
    if (name !== path.basename(file.filename)) await fsp.rm(path.join(modsDir, name), { force: true }).catch(() => {});
  }
  onLog('CustomSkinLoader is ready.');
  return true;
}

async function configureLocalSkin(gameDir, playerName) {
  const cslDir = path.join(gameDir, 'CustomSkinLoader');
  const skinDir = path.join(cslDir, 'LocalSkin', 'skins');
  await U.mkdirp(skinDir);
  // Match game.launch(): the same sanitized offline name is used in the session and local-skin file.
  const safeName = String(playerName || 'Player').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'Player';
  const markerPath = path.join(cslDir, 'KaliLauncherSkin.json');
  const previous = await U.readJson(markerPath, {});
  if (previous && previous.username && previous.username !== safeName) {
    await fsp.rm(path.join(skinDir, `${previous.username}.png`), { force: true }).catch(() => {});
  }
  await U.copyFile(config.skin, path.join(skinDir, `${safeName}.png`));

  const configPath = path.join(cslDir, 'CustomSkinLoader.json');
  const existing = await U.readJson(configPath, {});
  const localLoader = {
    name: 'LocalSkin',
    type: 'Legacy',
    checkPNG: false,
    skin: 'LocalSkin/skins/{USERNAME}.png',
    model: 'auto',
    cape: 'LocalSkin/capes/{USERNAME}.png',
    elytra: 'LocalSkin/elytras/{USERNAME}.png',
  };
  const loadlist = Array.isArray(existing.loadlist) ? existing.loadlist : [];
  const rest = loadlist.filter((item) => item && item.name !== 'LocalSkin');
  await U.writeJson(configPath, {
    ...existing,
    version: existing.version || '15.0.1',
    loadlist: [localLoader, ...rest],
    enableTransparentSkin: existing.enableTransparentSkin !== false,
  });
  await U.writeJson(path.join(cslDir, 'KaliLauncherSkin.json'), { username: safeName });
  return safeName;
}

async function applySkin(gameDir, loader, mcVersion, onLog = () => {}) {
  if (!config.skin || !(await U.exists(config.skin))) return false;
  const name = await configureLocalSkin(gameDir, config.playerName);
  const hasLoader = await ensureCustomSkinLoader(gameDir, mcVersion, loader, onLog).catch((error) => {
    onLog(`Could not install CustomSkinLoader: ${error.message}`);
    return false;
  });
  if (!hasLoader) onLog(`Local skin files were prepared for ${name}, but this profile does not have a compatible CustomSkinLoader mod.`);
  return hasLoader;
}
