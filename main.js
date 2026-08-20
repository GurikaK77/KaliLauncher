'use strict';
/* Rocket Launcher: მთავარი პროცესი */

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
    backgroundColor: '#f7f4ee',
    title: 'Rocket Launcher',
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
const onProgress = (p) => send('progress', p);
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
    onLog(`ახალი ვერსია მოიძებნა: ${info.version} — იტვირთება ფონურად`);
  });
  autoUpdater.on('download-progress', (p) => {
    send('update', { state: 'downloading', percent: Math.round(p.percent) });
  });
  autoUpdater.on('error', (err) => {
    send('update', { state: 'error', message: err && err.message });
    onLog(`განახლების შემოწმება ვერ მოხერხდა: ${err && err.message}`);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    send('update', { state: 'ready', version: info.version });
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'განახლება მზადაა',
      message: `Rocket Launcher ${info.version} ჩამოიტვირთა.`,
      detail: 'გადატვირთვის შემდეგ ახალ ვერსიაზე გადახვალთ ავტომატურად.',
      buttons: ['გადატვირთვა ახლავე', 'მოგვიანებით'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch((e) => onLog(`განახლების შემოწმება ვერ მოხერხდა: ${e.message}`));
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
handle('versions:mc', async (loader) => game.mcVersions(loader, config.snapshots));
handle('versions:loader', async ({ loader, mc }) => game.loaderVersions(loader, mc));
handle('optifine:list', async () => (await game.listOptifineJars()).map((j) => j.name));

handle('launch', async (opts) => {
  const isPack = Boolean(opts.packId);
  let launchOpts;
  if (isPack) {
    const list = await packs.installed();
    const pack = list.find((p) => p.id === opts.packId);
    if (!pack) throw new Error('მოდპაკი დაინსტალირებული არ არის');
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
  await applySkin(launchOpts.gameDir);

  const result = await game.launch({
    ...launchOpts,
    playerName: config.playerName,
    javaPath: config.javaPath || '',
    extraJvm: config.extraJvm || '',
    width: config.width || 0,
    height: config.height || 0,
  }, { onProgress, onLog });

  if (isPack) await packs.markPlayed(opts.packId);
  if (!config.keepOpen && win) win.minimize();
  return result;
});

handle('launch:stop', async () => game.stop());
handle('launch:state', async () => game.isRunning());

handle('packs:available', () => packs.available());
handle('packs:installed', () => packs.installed());
handle('packs:install', async (id) => {
  const r = await packs.install(id, (stage, pct) => onProgress({ stage, pct }));
  onProgress({ stage: 'მოდპაკი დაინსტალირდა', pct: 1 });
  return r;
});
handle('packs:update', async (id) => {
  const r = await packs.update(id, (stage, pct) => onProgress({ stage, pct }));
  onProgress({ stage: `განახლდა ${r.changed} ფაილი`, pct: 1 });
  return r;
});
handle('packs:remove', (id) => packs.remove(id, { keepWorlds: true }));
handle('packs:scaffold', async (name) => {
  const dir = await packs.scaffold(name);
  shell.openPath(dir);
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
    title: 'აირჩიე სკინი (64x64 PNG)',
    filters: [{ name: 'PNG', extensions: ['png'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const dest = path.join(app.getPath('userData'), 'skins', path.basename(res.filePaths[0]));
  await U.copyFile(res.filePaths[0], dest);
  config.skin = dest;
  await saveConfig();
  return { path: dest, data: await skinDataUrl(dest) };
});

handle('pick:java', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'აირჩიე java', properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return null;
  config.javaPath = res.filePaths[0];
  await saveConfig();
  return config.javaPath;
});

handle('skin:clear', async () => { config.skin = ''; await saveConfig(); return true; });

/* ---------- სკინი ---------- */

async function skinDataUrl(file) {
  try {
    const buf = await fsp.readFile(file);
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch { return null; }
}

/**
 * ოფლაინ რეჟიმში სკინს Mojang არ გვცემს, ამიტომ ვწერთ CustomSkinLoader-ის
 * ლოკალურ ფოლდერში: თუ პაკში ეს მოდი გაქვს, სკინი თამაშში გამოჩნდება.
 */
async function applySkin(gameDir) {
  if (!config.skin) return;
  const name = (config.playerName || 'Player').slice(0, 16);
  const targets = [
    path.join(gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins', `${name}.png`),
    path.join(gameDir, 'cachedImages', 'skins', `${name}.png`),
  ];
  for (const t of targets) await U.copyFile(config.skin, t).catch(() => {});
}
