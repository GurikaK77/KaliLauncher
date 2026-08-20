'use strict';
/* Rocket Launcher: საერთო დამხმარე ფუნქციები (ქსელი, zip, hash, პროცესები) */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

const MC_OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const MC_ARCH = ({ x64: 'x86_64', ia32: 'x86', arm64: 'arm64', arm: 'arm32' })[process.arch] || process.arch;
const ADOPT_OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
const ADOPT_ARCH = ({ x64: 'x64', ia32: 'x86', arm64: 'aarch64' })[process.arch] || 'x64';
const JAVA_BIN = MC_OS === 'windows' ? 'java.exe' : 'java';
const UA = 'RocketLauncher/1.0 (+standalone)';

let ROOT = path.join(os.homedir(), '.rocket-launcher');
function setRoot(dir) { ROOT = dir; }

const P = {
  root: () => ROOT,
  at: (...p) => path.join(ROOT, ...p),
  versions: (...p) => path.join(ROOT, 'versions', ...p),
  libraries: (...p) => path.join(ROOT, 'libraries', ...p),
  assets: (...p) => path.join(ROOT, 'assets', ...p),
  natives: (...p) => path.join(ROOT, 'natives', ...p),
  runtimes: (...p) => path.join(ROOT, 'runtimes', ...p),
  instances: (...p) => path.join(ROOT, 'instances', ...p),
  cache: (...p) => path.join(ROOT, 'cache', ...p),
  optifine: (...p) => path.join(ROOT, 'optifine', ...p),
};

const mkdirp = (d) => fsp.mkdir(d, { recursive: true });
async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }
async function readJson(f, fallback = null) {
  try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return fallback; }
}
async function writeJson(f, data) {
  await mkdirp(path.dirname(f));
  await fsp.writeFile(f, JSON.stringify(data, null, 2));
}

/* ---------- ქსელი ---------- */

function request(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('არასწორი URL: ' + url)); }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(u, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
      const loc = res.headers.location;
      if (loc && res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        if (redirects > 8) return reject(new Error('ზედმეტად ბევრი გადამისამართება: ' + url));
        return request(new URL(loc, url).toString(), redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('დროის ამოწურვა: ' + url)));
  });
}

async function fetchBuffer(url) {
  const res = await request(url);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks);
}
const fetchText = async (url) => (await fetchBuffer(url)).toString('utf8');
const fetchJson = async (url) => JSON.parse(await fetchText(url));

/** ქსელიდან წაკითხვა დისკზე ქეშირებით. ინტერნეტის გარეშე ბრუნდება ქეშიდან. */
async function cachedJson(url, cacheName, ttlMs = 1000 * 60 * 30) {
  const file = P.cache(cacheName);
  const stat = await fsp.stat(file).catch(() => null);
  if (stat && Date.now() - stat.mtimeMs < ttlMs) {
    const cached = await readJson(file);
    if (cached) return cached;
  }
  try {
    const data = await fetchJson(url);
    await writeJson(file, data);
    return data;
  } catch (e) {
    const cached = await readJson(file);
    if (cached) return cached;
    throw e;
  }
}

async function cachedText(url, cacheName, ttlMs = 1000 * 60 * 30) {
  const file = P.cache(cacheName);
  const stat = await fsp.stat(file).catch(() => null);
  if (stat && Date.now() - stat.mtimeMs < ttlMs) return fsp.readFile(file, 'utf8');
  try {
    const text = await fetchText(url);
    await mkdirp(path.dirname(file));
    await fsp.writeFile(file, text);
    return text;
  } catch (e) {
    if (stat) return fsp.readFile(file, 'utf8');
    throw e;
  }
}

/* ---------- hash ---------- */

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/* ---------- ფაილის ჩამოტვირთვა ---------- */

/**
 * ჩამოტვირთავს მხოლოდ მაშინ, თუ ფაილი აკლია ან hash არ ემთხვევა.
 * აბრუნებს true-ს, თუ რეალურად ჩამოიტვირთა.
 */
async function download(url, dest, opts = {}) {
  if (await exists(dest)) {
    if (!opts.sha1) return false;
    try { if ((await sha1File(dest)) === opts.sha1) return false; } catch { /* გადავწერთ */ }
  }
  await mkdirp(path.dirname(dest));
  const tmp = dest + '.part';
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await request(url);
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        if (opts.onBytes) res.on('data', (c) => opts.onBytes(c.length));
        res.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        res.pipe(out);
      });
      await fsp.rm(dest, { force: true });
      await fsp.rename(tmp, dest);
      return true;
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      if (attempt >= 3) throw e;
      await sleep(350 * attempt);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** პარალელური დამუშავება ლიმიტით. */
async function pool(items, limit, worker) {
  let i = 0;
  const errors = [];
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx], idx); } catch (e) { errors.push(e); }
    }
  });
  await Promise.all(runners);
  if (errors.length) throw errors[0];
}

/* ---------- zip (გარე ბიბლიოთეკის გარეშე) ---------- */

function readZipEntries(buf) {
  let eocd = -1;
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('დაზიანებული zip არქივი');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const attrs = buf.readUInt32LE(off + 38);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    entries.push({ name, method, csize, local, mode: (attrs >>> 16) & 0xfff });
    off += 46 + nlen + elen + clen;
  }
  return entries;
}

function inflateEntry(buf, e) {
  if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error('დაზიანებული ჩანაწერი: ' + e.name);
  const nlen = buf.readUInt16LE(e.local + 26);
  const elen = buf.readUInt16LE(e.local + 28);
  const start = e.local + 30 + nlen + elen;
  const data = buf.slice(start, start + e.csize);
  return e.method === 0 ? data : zlib.inflateRawSync(data);
}

/** ამოშლის zip-ს დირექტორიაში. filter(name) => boolean. */
async function unzip(zipFile, destDir, filter) {
  const buf = await fsp.readFile(zipFile);
  const entries = readZipEntries(buf);
  const rootAbs = path.resolve(destDir);
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    if (filter && !filter(e.name)) continue;
    const target = path.join(destDir, e.name);
    if (!path.resolve(target).startsWith(rootAbs)) continue;
    await mkdirp(path.dirname(target));
    await fsp.writeFile(target, inflateEntry(buf, e));
    if (e.mode & 0o111) await fsp.chmod(target, 0o755).catch(() => {});
  }
}

async function readZipFile(zipFile, entryName) {
  const buf = await fsp.readFile(zipFile);
  const e = readZipEntries(buf).find((x) => x.name === entryName);
  return e ? inflateEntry(buf, e) : null;
}

/* ---------- პროცესები ---------- */

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) } });
    let out = '';
    const onData = (b) => {
      const s = b.toString();
      out += s;
      if (opts.onLine) s.split(/\r?\n/).forEach((l) => l.trim() && opts.onLine(l.trim()));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || opts.allowFail) resolve({ code, out });
      else reject(new Error(`${path.basename(cmd)} დასრულდა კოდით ${code}\n${out.slice(-1500)}`));
    });
  });
}

/* ---------- maven / წესები ---------- */

function mavenPath(name) {
  let ext = 'jar';
  const at = name.indexOf('@');
  if (at > -1) { ext = name.slice(at + 1); name = name.slice(0, at); }
  const parts = name.split(':');
  const [group, artifact, version] = parts;
  const classifier = parts[3];
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return path.join(...group.split('.'), artifact, version, file);
}
const toUrlPath = (p) => p.split(path.sep).join('/');

function rulesAllow(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allow = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== MC_OS) match = false;
      if (r.os.arch && r.os.arch !== MC_ARCH) match = false;
      if (r.os.version) { try { if (!new RegExp(r.os.version).test(os.release())) match = false; } catch {} }
    }
    if (r.features) {
      for (const [k, v] of Object.entries(r.features)) {
        if (Boolean(features[k]) !== Boolean(v)) match = false;
      }
    }
    if (match) allow = r.action === 'allow';
  }
  return allow;
}

/* ---------- ფაილური სისტემა ---------- */

async function walk(dir, base = dir, acc = []) {
  const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) await walk(full, base, acc);
    else if (it.isFile()) acc.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return acc;
}

async function copyFile(src, dest) {
  await mkdirp(path.dirname(dest));
  await fsp.copyFile(src, dest);
}

async function dirSize(dir) {
  let total = 0;
  for (const rel of await walk(dir)) {
    const st = await fsp.stat(path.join(dir, rel)).catch(() => null);
    if (st) total += st.size;
  }
  return total;
}

function humanSize(bytes) {
  if (!bytes) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 1 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** ოფლაინ UUID: იგივე ალგორითმი, რასაც სერვერები იყენებენ offline-mode-ში. */
function offlineUuid(name) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'pack';

module.exports = {
  MC_OS, MC_ARCH, ADOPT_OS, ADOPT_ARCH, JAVA_BIN, P, setRoot,
  mkdirp, exists, readJson, writeJson, walk, copyFile, dirSize, humanSize,
  request, fetchBuffer, fetchText, fetchJson, cachedJson, cachedText,
  sha1, sha1File, download, pool, sleep,
  unzip, readZipFile, readZipEntries, run,
  mavenPath, toUrlPath, rulesAllow, offlineUuid, slug,
};
