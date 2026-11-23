'use strict';
/* KaliLauncher: მოდპაკები (modpack-files -> instances), ინსტალაცია და განახლება */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const U = require('./util');
const { P } = U;

const INDEX = '.rocket-index.json';
const META = '.rocket-pack.json';

/** განახლებისას არასოდეს ვშლით და არ ვწერთ ამ ადგილებს. */
const PROTECTED = [
  'saves', 'screenshots', 'logs', 'crash-reports', 'backups', 'schematics',
  'options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat', 'servers.dat_old',
  'usercache.json', 'realms_persistence.json', 'hotbar.nbt', 'CustomSkinLoader',
  INDEX, META,
];

const isProtected = (rel) => PROTECTED.some((p) => rel === p || rel.startsWith(p + '/'));

let SOURCE_DIR = path.join(process.cwd(), 'modpack-files');
const setSourceDir = (dir) => { SOURCE_DIR = dir; };
const sourceDir = () => SOURCE_DIR;
const packSource = (id) => path.join(SOURCE_DIR, id);
const packFiles = (id) => path.join(SOURCE_DIR, id, 'files');
const instanceDir = (id) => P.instances('pack-' + U.slug(id));

/* ---------- წაკითხვა ---------- */

async function readMeta(dir, folderName) {
  const meta = (await U.readJson(path.join(dir, 'modpack.json'))) || {};
  const id = U.slug(meta.id || folderName);
  return {
    id,
    folder: folderName,
    name: meta.name || folderName,
    version: String(meta.version || '1.0.0'),
    author: meta.author || 'Unknown',
    description: meta.description || '',
    mcVersion: meta.mcVersion || meta.minecraft || '1.20.1',
    loader: (meta.loader || 'forge').toLowerCase(),
    loaderVersion: meta.loaderVersion || '',
    ram: meta.ram || 0,
    tags: meta.tags || [],
    website: meta.website || '',
    changelog: meta.changelog || '',
    icon: meta.icon || 'icon.png',
  };
}

async function iconDataUrl(dir, iconName) {
  for (const candidate of [iconName, 'icon.png', 'pack.png']) {
    if (!candidate) continue;
    const file = path.join(dir, candidate);
    if (await U.exists(file)) {
      const buf = await fsp.readFile(file);
      const ext = path.extname(file).slice(1).toLowerCase() === 'jpg' ? 'jpeg' : path.extname(file).slice(1).toLowerCase();
      return `data:image/${ext};base64,${buf.toString('base64')}`;
    }
  }
  return null;
}

/**
 * ინდექსი: rel -> {size, hash}. content-hash-ს ვიყენებთ mtime-ის მაგივრად, რადგან
 * ყოველი ახალი electron-builder build ხელახლა წერს resources-ის ფაილებს დისკზე —
 * ბაიტობრივად უცვლელ ფაილსაც კი ახალი mtime ეყრება, რაც ცრუ "განახლებას" იწვევდა
 * აპის ყოველ ახალ ვერსიაზე, მოდპაკის საკუთარი შემცველობის შეცვლის გარეშეც კი.
 */
function hashFile(p) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(p);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

async function buildIndex(dir) {
  const files = {};
  for (const rel of await U.walk(dir)) {
    const p = path.join(dir, rel);
    const st = await fsp.stat(p).catch(() => null);
    if (!st) continue;
    files[rel] = { size: st.size, hash: await hashFile(p) };
  }
  return files;
}

/** მოკლედ: ერთი ფაილის (მაგ. icon.png) "თითის ანაბეჭდი" — ზომა+hash, ან null თუ არ არსებობს. */
async function fileFingerprint(p) {
  const st = await fsp.stat(p).catch(() => null);
  if (!st) return null;
  return `${st.size}:${await hashFile(p)}`;
}

async function resolveIconFile(dir, iconName) {
  for (const candidate of [iconName, 'icon.png', 'pack.png']) {
    if (!candidate) continue;
    const file = path.join(dir, candidate);
    if (await U.exists(file)) return file;
  }
  return null;
}

const differs = (a, b) => !a || !b || a.size !== b.size || a.hash !== b.hash;

/* ---------- სია ---------- */

async function available() {
  await U.mkdirp(SOURCE_DIR);
  const dirs = await fsp.readdir(SOURCE_DIR, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const dir = path.join(SOURCE_DIR, d.name);
    const meta = await readMeta(dir, d.name);
    const filesDir = path.join(dir, 'files');
    const hasFiles = await U.exists(filesDir);
    const inst = await installedOne(meta.id);
    out.push({
      ...meta,
      icon: await iconDataUrl(dir, meta.icon),
      size: hasFiles ? await U.dirSize(filesDir) : 0,
      fileCount: hasFiles ? (await U.walk(filesDir)).length : 0,
      valid: hasFiles,
      installed: Boolean(inst),
      installedVersion: inst ? inst.version : null,
      updateAvailable: inst ? await hasUpdate(meta, inst) : false,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ka'));
}

async function hasUpdate(sourceMeta, installedMeta) {
  if (installedMeta.version !== sourceMeta.version) return true;
  if ((installedMeta.name || '') !== (sourceMeta.name || '')) return true;
  const dir = instanceDir(sourceMeta.id);
  const sourceDir = packSource(sourceMeta.folder);
  const iconFile = await resolveIconFile(sourceDir, sourceMeta.icon);
  const iconFp = iconFile ? await fileFingerprint(iconFile) : null;
  if ((installedMeta.iconFingerprint || null) !== iconFp) return true;
  const saved = await U.readJson(path.join(dir, INDEX));
  if (!saved || !saved.files) return true;
  const src = await buildIndex(packFiles(sourceMeta.folder));
  const srcKeys = Object.keys(src);
  if (srcKeys.length !== Object.keys(saved.files).length) return true;
  return srcKeys.some((k) => differs(src[k], saved.files[k]));
}

async function installedOne(id) {
  const dir = instanceDir(id);
  const meta = await U.readJson(path.join(dir, META));
  if (!meta) return null;
  return meta;
}

async function installed() {
  await U.mkdirp(P.instances());
  const dirs = await fsp.readdir(P.instances(), { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith('pack-')) continue;
    const dir = P.instances(d.name);
    const meta = await U.readJson(path.join(dir, META));
    if (!meta) continue;
    const source = path.join(SOURCE_DIR, meta.folder || meta.id);
    const sourceMeta = (await U.exists(source)) ? await readMeta(source, meta.folder || meta.id) : null;
    out.push({
      ...meta,
      dir,
      icon: sourceMeta ? await iconDataUrl(source, sourceMeta.icon) : null,
      size: await U.dirSize(dir),
      worlds: (await fsp.readdir(path.join(dir, 'saves')).catch(() => [])).filter((w) => !w.startsWith('.')).length,
      sourceVersion: sourceMeta ? sourceMeta.version : null,
      updateAvailable: sourceMeta ? await hasUpdate(sourceMeta, meta) : false,
      orphan: !sourceMeta,
    });
  }
  return out.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
}

/* ---------- ინსტალაცია / განახლება ---------- */

async function install(id, prog = () => {}) {
  const list = await available();
  const pack = list.find((p) => p.id === id);
  if (!pack) throw new Error(`Modpack "${id}" was not found in modpack-files`);
  if (!pack.valid) throw new Error(`"${pack.name}" is missing its files/ folder`);

  const src = packFiles(pack.folder);
  const dest = instanceDir(pack.id);
  await U.mkdirp(dest);
  const files = await U.walk(src);
  let done = 0;
  for (const rel of files) {
    if (!isProtected(rel)) await U.copyFile(path.join(src, rel), path.join(dest, rel));
    done++;
    if (done % 10 === 0 || done === files.length) prog(`Files ${done}/${files.length}`, done / files.length);
  }
  const index = await buildIndex(src);
  const iconFile = await resolveIconFile(packSource(pack.folder), pack.icon);
  const iconFingerprint = iconFile ? await fileFingerprint(iconFile) : null;
  await U.writeJson(path.join(dest, INDEX), { version: pack.version, files: index });
  await U.writeJson(path.join(dest, META), {
    id: pack.id, folder: pack.folder, name: pack.name, version: pack.version, author: pack.author,
    description: pack.description, mcVersion: pack.mcVersion, loader: pack.loader,
    loaderVersion: pack.loaderVersion, ram: pack.ram, iconFingerprint, installedAt: Date.now(), lastPlayed: 0,
  });
  return { ok: true, dir: dest, files: files.length };
}

/**
 * განახლება: ცვლის მხოლოდ შეცვლილ ფაილებს, შლის ავტორის მიერ ამოღებულებს,
 * და არ ეხება saves/, options.txt-ს და დანარჩენ პირად მონაცემებს.
 */
async function update(id, prog = () => {}) {
  const list = await available();
  const pack = list.find((p) => p.id === id);
  if (!pack) throw new Error(`Modpack "${id}" no longer exists in modpack-files`);
  const src = packFiles(pack.folder);
  const dest = instanceDir(pack.id);
  const prevIndex = (await U.readJson(path.join(dest, INDEX))) || { files: {} };
  const srcIndex = await buildIndex(src);
  const srcKeys = Object.keys(srcIndex);

  let changed = 0;
  let i = 0;
  for (const rel of srcKeys) {
    i++;
    if (isProtected(rel)) continue;
    const target = path.join(dest, rel);
    const needs = differs(srcIndex[rel], prevIndex.files[rel]) || !(await U.exists(target));
    if (needs) { await U.copyFile(path.join(src, rel), target); changed++; }
    if (i % 20 === 0 || i === srcKeys.length) prog(`Comparing ${i}/${srcKeys.length}`, i / srcKeys.length);
  }

  let removed = 0;
  for (const rel of Object.keys(prevIndex.files)) {
    if (srcIndex[rel] || isProtected(rel)) continue;
    const target = path.join(dest, rel);
    if (await U.exists(target)) { await fsp.rm(target, { force: true }); removed++; }
  }
  await pruneEmptyDirs(dest);

  const iconFile = await resolveIconFile(packSource(pack.folder), pack.icon);
  const iconFingerprint = iconFile ? await fileFingerprint(iconFile) : null;
  await U.writeJson(path.join(dest, INDEX), { version: pack.version, files: srcIndex });
  const meta = (await U.readJson(path.join(dest, META))) || {};
  await U.writeJson(path.join(dest, META), {
    ...meta, id: pack.id, folder: pack.folder, name: pack.name, version: pack.version, author: pack.author,
    mcVersion: pack.mcVersion, loader: pack.loader, loaderVersion: pack.loaderVersion,
    description: pack.description, iconFingerprint, updatedAt: Date.now(),
  });
  return { ok: true, changed, removed, version: pack.version };
}

async function pruneEmptyDirs(dir, root = dir) {
  const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const it of items) {
    if (!it.isDirectory()) continue;
    const full = path.join(dir, it.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (isProtected(rel)) continue;
    await pruneEmptyDirs(full, root);
    const left = await fsp.readdir(full).catch(() => ['x']);
    if (!left.length) await fsp.rmdir(full).catch(() => {});
  }
}

async function remove(id, { keepWorlds = true } = {}) {
  const dir = instanceDir(id);
  if (!(await U.exists(dir))) return { ok: true };
  if (keepWorlds) {
    const saves = path.join(dir, 'saves');
    if (await U.exists(saves)) {
      const backup = P.at('saved-worlds', U.slug(id) + '-' + Date.now());
      await U.mkdirp(path.dirname(backup));
      await fsp.rename(saves, backup).catch(async () => {
        await fsp.cp(saves, backup, { recursive: true });
      });
      await fsp.rm(dir, { recursive: true, force: true });
      return { ok: true, worldsMovedTo: backup };
    }
  }
  await fsp.rm(dir, { recursive: true, force: true });
  return { ok: true };
}

async function markPlayed(id) {
  const file = path.join(instanceDir(id), META);
  const meta = await U.readJson(file);
  if (meta) await U.writeJson(file, { ...meta, lastPlayed: Date.now() });
}

/** ცარიელი ჩონჩხი ახალი მოდპაკისთვის, რომ ხელით არ აწყობდე. */
async function scaffold(options = {}) {
  const name = String(options.name || '').trim();
  if (!name) throw new Error('A modpack name is required.');
  const folder = U.slug(name);
  const dir = path.join(SOURCE_DIR, folder);
  if (await U.exists(path.join(dir, 'modpack.json'))) throw new Error('A modpack with this name already exists.');
  const loader = String(options.loader || 'vanilla').toLowerCase();
  const mcVersion = String(options.mcVersion || '').trim();
  const loaderVersion = String(options.loaderVersion || '').trim();
  if (!mcVersion) throw new Error('Choose a Minecraft version.');
  if (!['vanilla', 'fabric', 'forge', 'neoforge', 'optifine'].includes(loader)) throw new Error('Unsupported mod loader.');
  if (loader !== 'vanilla' && !loaderVersion) throw new Error('Choose a loader version.');
  await U.mkdirp(path.join(dir, 'files', 'mods'));
  await U.mkdirp(path.join(dir, 'files', 'config'));
  await U.writeJson(path.join(dir, 'modpack.json'), {
    id: folder,
    name,
    version: String(options.version || '1.0.0'),
    author: 'Gurika',
    description: '',
    mcVersion,
    loader,
    loaderVersion: loader === 'vanilla' ? '' : loaderVersion,
    ram: 6144,
    icon: 'icon.png',
  });
  return dir;
}

module.exports = {
  setSourceDir, sourceDir, instanceDir, packSource,
  available, installed, install, update, remove, markPlayed, scaffold,
};
