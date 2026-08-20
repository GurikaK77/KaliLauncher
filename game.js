'use strict';
/* Rocket Launcher: ვერსიების ინსტალაცია, ლოადერები, Java, გაშვება */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const U = require('./util');
const { P } = U;

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES = 'https://resources.download.minecraft.net';
const LIBS_FALLBACK = 'https://libraries.minecraft.net/';
const FABRIC = 'https://meta.fabricmc.net/v2';
const FORGE_META = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const FORGE_JAR = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEO_META = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const NEO_JAR = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const ADOPTIUM = 'https://api.adoptium.net/v3/binary/latest';

const LAUNCHER_NAME = 'RocketLauncher';
const LAUNCHER_VERSION = '1.0';

let running = null; // აქტიური თამაშის პროცესი

/* ============ ვერსიების სია ============ */

const manifest = () => U.cachedJson(MANIFEST, 'version_manifest_v2.json');

function parseMavenMetadata(xml) {
  const out = [];
  const re = /<version>([^<]+)<\/version>/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

const forgeAll = async () => parseMavenMetadata(await U.cachedText(FORGE_META, 'forge-metadata.xml', 1000 * 60 * 60 * 6));
const neoAll = async () => parseMavenMetadata(await U.cachedText(NEO_META, 'neoforge-metadata.xml', 1000 * 60 * 60 * 6));

/** NeoForge: 21.1.73 => 1.21.1, 21.0.167 => 1.21 */
function neoToMc(v) {
  const [maj, min] = v.split('.');
  if (!maj || min === undefined) return null;
  return min === '0' ? `1.${maj}` : `1.${maj}.${min}`;
}

/** MC ვერსიების სია მოცემული ლოადერისთვის, Mojang-ის ქრონოლოგიური რიგით. */
async function mcVersions(loader, snapshots = false) {
  const man = await manifest();
  const ordered = man.versions.filter((v) => snapshots || v.type === 'release').map((v) => v.id);
  if (loader === 'vanilla' || loader === 'optifine') return ordered;
  let supported;
  if (loader === 'fabric') {
    const games = await U.cachedJson(`${FABRIC}/versions/game`, 'fabric-games.json', 1000 * 60 * 60 * 6);
    supported = new Set(games.map((g) => g.version));
  } else if (loader === 'forge') {
    supported = new Set((await forgeAll()).map((v) => v.split('-')[0]));
  } else if (loader === 'neoforge') {
    supported = new Set((await neoAll()).map(neoToMc).filter(Boolean));
  } else return ordered;
  return ordered.filter((v) => supported.has(v));
}

const cmpBuild = (a, b) => {
  const pa = a.split(/[.\-+]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.\-+]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
};

/** ლოადერის ბილდების სია არჩეული MC ვერსიისთვის (უახლესი პირველი). */
async function loaderVersions(loader, mc) {
  if (loader === 'vanilla') return [];
  if (loader === 'fabric') {
    const list = await U.cachedJson(`${FABRIC}/versions/loader/${mc}`, `fabric-loader-${mc}.json`, 1000 * 60 * 60);
    return list.map((l) => l.loader.version);
  }
  if (loader === 'forge') {
    return (await forgeAll()).filter((v) => v.split('-')[0] === mc).map((v) => v.split('-').slice(1).join('-')).sort(cmpBuild);
  }
  if (loader === 'neoforge') {
    return (await neoAll()).filter((v) => neoToMc(v) === mc).sort(cmpBuild);
  }
  if (loader === 'optifine') return listOptifineJars().then((j) => j.map((x) => x.name));
  return [];
}

async function listOptifineJars() {
  await U.mkdirp(P.optifine());
  const files = await fsp.readdir(P.optifine()).catch(() => []);
  return files.filter((f) => f.toLowerCase().endsWith('.jar')).map((f) => ({ name: f, file: P.optifine(f) }));
}

/* ============ ვერსიის json ============ */

async function ensureVersionJson(id) {
  const local = P.versions(id, id + '.json');
  const cached = await U.readJson(local);
  if (cached) return cached;
  const man = await manifest();
  const entry = man.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`ვერსია "${id}" ვერ მოიძებნა Mojang-ის მანიფესტში`);
  await U.download(entry.url, local, { sha1: entry.sha1 });
  const json = await U.readJson(local);
  if (!json) throw new Error(`ვერსიის ფაილი დაზიანებულია: ${id}`);
  return json;
}

/** ვერსიის სრული აღწერა inheritsFrom ჯაჭვის გახსნით (Fabric/Forge/NeoForge/OptiFine). */
async function resolveVersion(id) {
  const chain = [];
  let json = await ensureVersionJson(id);
  chain.push(json);
  const guard = new Set([id]);
  while (json.inheritsFrom && !guard.has(json.inheritsFrom)) {
    guard.add(json.inheritsFrom);
    json = await ensureVersionJson(json.inheritsFrom);
    chain.push(json);
  }
  const base = chain[chain.length - 1];
  const pick = (key) => { const c = chain.find((x) => x[key] !== undefined); return c ? c[key] : undefined; };
  const merged = {
    id: chain[0].id,
    baseId: base.id,
    mainClass: pick('mainClass'),
    assetIndex: pick('assetIndex'),
    assets: pick('assets'),
    javaVersion: pick('javaVersion'),
    type: pick('type') || 'release',
    downloads: base.downloads || {},
    minecraftArguments: pick('minecraftArguments'),
    libraries: chain.flatMap((c) => c.libraries || []),
    arguments: { game: [], jvm: [] },
  };
  for (const c of [...chain].reverse()) {
    if (c.arguments) {
      merged.arguments.game.push(...(c.arguments.game || []));
      merged.arguments.jvm.push(...(c.arguments.jvm || []));
    }
  }
  return merged;
}

const isNativeName = (name = '') => /:natives-/.test(name);

function libraryTargets(merged) {
  const jobs = [];
  const cp = new Map();
  const natives = [];
  for (const lib of merged.libraries) {
    if (!U.rulesAllow(lib.rules)) continue;
    const d = lib.downloads || {};
    const legacyNative = lib.natives && lib.natives[U.MC_OS];

    if (legacyNative) {
      const key = legacyNative.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
      const c = d.classifiers && d.classifiers[key];
      if (c) {
        const dest = P.libraries(c.path);
        jobs.push({ url: c.url, dest, sha1: c.sha1, size: c.size });
        natives.push(dest);
      } else if (lib.name) {
        const rel = U.mavenPath(`${lib.name}:${key}`);
        const dest = P.libraries(rel);
        jobs.push({ url: (lib.url || LIBS_FALLBACK).replace(/\/?$/, '/') + U.toUrlPath(rel), dest, soft: true });
        natives.push(dest);
      }
      continue; // legacy native jar არ მიდის classpath-ში
    }

    const rel = d.artifact && d.artifact.path ? d.artifact.path : lib.name ? U.mavenPath(lib.name) : null;
    if (!rel) continue;
    const dest = P.libraries(rel);
    const url = d.artifact && d.artifact.url ? d.artifact.url
      : (lib.url || LIBS_FALLBACK).replace(/\/?$/, '/') + U.toUrlPath(rel);
    // ცარიელი url = ფაილს installer აწყობს ლოკალურად (Forge/NeoForge)
    if (!(d.artifact && d.artifact.url === '')) {
      jobs.push({ url, dest, sha1: d.artifact && d.artifact.sha1, size: d.artifact && d.artifact.size, soft: !(d.artifact && d.artifact.url) });
    }
    const key = (lib.name || rel).split(':').slice(0, 2).join(':') + (isNativeName(lib.name) ? ':native' : '');
    if (!cp.has(key)) cp.set(key, dest);
    if (isNativeName(lib.name)) natives.push(dest);
  }
  return { jobs, classpath: [...cp.values()], natives };
}

async function downloadLibraries(merged, prog) {
  const { jobs } = libraryTargets(merged);
  let done = 0;
  await U.pool(jobs, 10, async (j) => {
    try {
      await U.download(j.url, j.dest, { sha1: j.sha1 });
    } catch (e) {
      if (!(j.soft && (await U.exists(j.dest)))) {
        if (!j.soft) throw e;
      }
    }
    done++;
    if (done % 5 === 0 || done === jobs.length) prog(`ბიბლიოთეკები ${done}/${jobs.length}`, 0.15 + 0.3 * (done / jobs.length));
  });
}

async function extractNatives(merged, id) {
  const { natives } = libraryTargets(merged);
  const dir = P.natives(id);
  await U.mkdirp(dir);
  for (const jar of natives) {
    if (!(await U.exists(jar))) continue;
    await U.unzip(jar, dir, (name) => !name.startsWith('META-INF/') && !name.endsWith('/') && /\.(dll|so|dylib|jnilib)$/i.test(name));
  }
  return dir;
}

async function downloadAssets(merged, gameDir, prog) {
  const ai = merged.assetIndex;
  if (!ai) return;
  const indexFile = P.assets('indexes', `${ai.id}.json`);
  await U.download(ai.url, indexFile, { sha1: ai.sha1 });
  const index = await U.readJson(indexFile, { objects: {} });
  const objects = Object.entries(index.objects);
  let done = 0;
  await U.pool(objects, 16, async ([, o]) => {
    const sub = o.hash.slice(0, 2);
    await U.download(`${RESOURCES}/${sub}/${o.hash}`, P.assets('objects', sub, o.hash));
    done++;
    if (done % 50 === 0 || done === objects.length) {
      prog(`რესურსები ${done}/${objects.length}`, 0.5 + 0.4 * (done / objects.length));
    }
  });
  // ძველი ვერსიები (1.7.2 და უფრო ადრე) ითხოვს "ვირტუალურ" რესურსებს
  if (index.virtual || index.map_to_resources) {
    const target = index.map_to_resources ? path.join(gameDir, 'resources') : P.assets('virtual', ai.id);
    for (const [name, o] of objects) {
      const dest = path.join(target, name);
      if (await U.exists(dest)) continue;
      await U.copyFile(P.assets('objects', o.hash.slice(0, 2), o.hash), dest).catch(() => {});
    }
    return target;
  }
}

/* ============ Java ============ */

async function findJava(dir) {
  const candidates = [
    path.join(dir, 'bin', U.JAVA_BIN),
    path.join(dir, 'Contents', 'Home', 'bin', U.JAVA_BIN),
  ];
  for (const c of candidates) if (await U.exists(c)) return c;
  for (const sub of await fsp.readdir(dir).catch(() => [])) {
    const inner = path.join(dir, sub);
    const st = await fsp.stat(inner).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    const found = await findJava(inner);
    if (found) return found;
  }
  return null;
}

/** საჭირო Java-ს მოტანა: სისტემურს არ ეყრდნობა, თვითონ იწერს Adoptium-იდან. */
async function ensureJava(major, prog) {
  const dir = P.runtimes(String(major));
  const existing = (await U.exists(dir)) ? await findJava(dir) : null;
  if (existing) return existing;

  const ext = U.ADOPT_OS === 'windows' ? 'zip' : 'tar.gz';
  const url = `${ADOPTIUM}/${major}/ga/${U.ADOPT_OS}/${U.ADOPT_ARCH}/jre/hotspot/normal/eclipse`;
  const archive = P.cache(`jre-${major}-${U.ADOPT_OS}-${U.ADOPT_ARCH}.${ext}`);
  let got = 0;
  prog(`Java ${major} ჩამოტვირთვა`, 0.02);
  await U.download(url, archive, {
    onBytes: (n) => {
      got += n;
      if (got % (2 * 1024 * 1024) < n) prog(`Java ${major}: ${U.humanSize(got)}`, null);
    },
  });
  prog(`Java ${major} ამოშლა`, null);
  await U.mkdirp(dir);
  if (ext === 'zip') await U.unzip(archive, dir);
  else await U.run('tar', ['-xzf', archive, '-C', dir]);
  await fsp.rm(archive, { force: true }).catch(() => {});
  const java = await findJava(dir);
  if (!java) throw new Error(`Java ${major} ვერ დაინსტალირდა`);
  if (U.MC_OS !== 'windows') await fsp.chmod(java, 0o755).catch(() => {});
  return java;
}

/* ============ ლოადერების ინსტალაცია ============ */

async function localVersions() {
  const dirs = await fsp.readdir(P.versions(), { withFileTypes: true }).catch(() => []);
  return dirs.filter((d) => d.isDirectory()).map((d) => d.name);
}

async function writeLauncherProfiles() {
  const file = P.at('launcher_profiles.json');
  if (await U.exists(file)) return;
  await U.writeJson(file, {
    profiles: {}, selectedProfile: '', clientToken: '', authenticationDatabase: {},
    launcherVersion: { name: LAUNCHER_VERSION, format: 21, profilesFormat: 2 }, settings: {},
  });
}

async function installFabric(mc, loaderVersion, prog) {
  if (!loaderVersion) {
    const list = await loaderVersions('fabric', mc);
    loaderVersion = list[0];
  }
  const id = `fabric-loader-${loaderVersion}-${mc}`;
  const dest = P.versions(id, `${id}.json`);
  if (!(await U.exists(dest))) {
    prog('Fabric-ის პროფილის მოტანა', 0.02);
    const json = await U.fetchJson(`${FABRIC}/versions/loader/${mc}/${loaderVersion}/profile/json`);
    await U.writeJson(dest, json);
  }
  return id;
}

async function runInstaller({ label, jarUrl, jarName, mc, prog, log }) {
  // installer-ს სჭირდება ვანილას ვერსია და Java, ამიტომ პირველად ბაზას ვაწყობთ
  const base = await installVersion(mc, prog, log);
  await writeLauncherProfiles();
  const jar = P.cache(jarName);
  prog(`${label}: installer-ის ჩამოტვირთვა`, 0.05);
  await U.download(jarUrl, jar);
  const before = await localVersions();
  prog(`${label}: ინსტალაცია`, 0.1);
  await U.run(base.java, ['-jar', jar, '--installClient', P.root()], { cwd: P.root(), onLine: log });
  const after = await localVersions();
  const created = after.filter((v) => !before.includes(v));
  return created;
}

async function installForge(mc, forgeVersion, prog, log) {
  if (!forgeVersion) forgeVersion = (await loaderVersions('forge', mc))[0];
  const full = `${mc}-${forgeVersion}`;
  const guesses = [`${mc}-forge-${forgeVersion}`, `${mc}-forge${forgeVersion}`, `${full}`];
  for (const g of guesses) if (await U.exists(P.versions(g, `${g}.json`))) return g;
  const created = await runInstaller({
    label: 'Forge', mc, prog, log,
    jarUrl: `${FORGE_JAR}/${full}/forge-${full}-installer.jar`,
    jarName: `forge-${full}-installer.jar`,
  });
  const found = created.find((v) => v.toLowerCase().includes('forge')) || created[0];
  if (!found) throw new Error('Forge ვერსია ვერ შეიქმნა. სცადე სხვა ბილდი.');
  return found;
}

async function installNeoForge(mc, neoVersion, prog, log) {
  if (!neoVersion) neoVersion = (await loaderVersions('neoforge', mc))[0];
  const guesses = [`neoforge-${neoVersion}`, `${mc}-neoforge-${neoVersion}`];
  for (const g of guesses) if (await U.exists(P.versions(g, `${g}.json`))) return g;
  const created = await runInstaller({
    label: 'NeoForge', mc, prog, log,
    jarUrl: `${NEO_JAR}/${neoVersion}/neoforge-${neoVersion}-installer.jar`,
    jarName: `neoforge-${neoVersion}-installer.jar`,
  });
  const found = created.find((v) => v.toLowerCase().includes('neoforge')) || created[0];
  if (!found) throw new Error('NeoForge ვერსია ვერ შეიქმნა. სცადე სხვა ბილდი.');
  return found;
}

/**
 * OptiFine: ოფიციალური API არ არსებობს, ამიტომ jar-ს იღებს optifine/ ფოლდერიდან.
 * installer ხსნის პატარა ფანჯარას, სადაც უკვე ჩასმულია ჩვენი data ფოლდერი.
 */
async function installOptiFine(mc, jarName, prog, log) {
  const jars = await listOptifineJars();
  const pick = jars.find((j) => j.name === jarName) || jars.find((j) => j.name.includes(mc));
  if (!pick) {
    throw new Error(`OptiFine jar ვერ მოიძებნა. ჩააგდე ფაილი ფოლდერში: ${P.optifine()}`);
  }
  const existing = (await localVersions()).find((v) => v.includes('OptiFine') && v.includes(mc));
  if (existing) return existing;
  const created = await runInstallerGui(mc, pick.file, prog, log);
  const found = created.find((v) => v.includes('OptiFine')) || created[0];
  if (!found) throw new Error('OptiFine ვერსია ვერ შეიქმნა (installer-ში აირჩიე ჩვენი data ფოლდერი).');
  return found;
}

async function runInstallerGui(mc, jar, prog, log) {
  const base = await installVersion(mc, prog, log);
  await writeLauncherProfiles();
  const before = await localVersions();
  prog('OptiFine installer გაშვებულია (დაადასტურე ფანჯარაში)', 0.1);
  await U.run(base.java, ['-jar', jar], { cwd: P.root(), env: { user_home: P.root() }, onLine: log, allowFail: true });
  const after = await localVersions();
  return after.filter((v) => !before.includes(v));
}

/* ============ ინსტალაცია + გაშვება ============ */

async function resolveTargetId({ loader, mcVersion, loaderVersion }, prog, log) {
  switch (loader) {
    case 'fabric': return installFabric(mcVersion, loaderVersion, prog);
    case 'forge': return installForge(mcVersion, loaderVersion, prog, log);
    case 'neoforge': return installNeoForge(mcVersion, loaderVersion, prog, log);
    case 'optifine': return installOptiFine(mcVersion, loaderVersion, prog, log);
    default: return mcVersion;
  }
}

/** ჩამოტვირთავს ყველაფერს, რაც ვერსიას სჭირდება და აბრუნებს გაშვების მასალას. */
async function installVersion(id, prog, log, gameDir = P.instances('shared')) {
  const merged = await resolveVersion(id);
  prog('client jar', 0.08);
  const clientJar = P.versions(merged.baseId, `${merged.baseId}.jar`);
  if (merged.downloads.client) {
    await U.download(merged.downloads.client.url, clientJar, { sha1: merged.downloads.client.sha1 });
  }
  prog('ბიბლიოთეკები', 0.15);
  await downloadLibraries(merged, prog);
  const nativesDir = await extractNatives(merged, id);
  prog('რესურსები', 0.5);
  const virtualAssets = await downloadAssets(merged, gameDir, prog);
  const javaMajor = (merged.javaVersion && merged.javaVersion.majorVersion) || 8;
  const java = await ensureJava(javaMajor, prog);
  return { merged, clientJar, nativesDir, virtualAssets, java, javaMajor };
}

function substitute(str, vars) {
  return String(str).replace(/\$\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

function expandArgs(list, vars, features) {
  const out = [];
  for (const a of list) {
    if (typeof a === 'string') out.push(substitute(a, vars));
    else if (a && a.value !== undefined) {
      if (a.rules && !U.rulesAllow(a.rules, features)) continue;
      const vals = Array.isArray(a.value) ? a.value : [a.value];
      out.push(...vals.map((v) => substitute(v, vars)));
    }
  }
  return out.filter((s) => s !== '');
}

/**
 * მთავარი შესასვლელი: აწყობს ყველაფერს და უშვებს თამაშს.
 * opts: { loader, mcVersion, loaderVersion, gameDir, playerName, ram, javaPath, width, height, extraJvm }
 */
async function launch(opts, { onProgress, onLog }) {
  const prog = (stage, pct, line) => onProgress({ stage, pct, line });
  const log = (l) => onLog(l);
  if (running) throw new Error('თამაში უკვე გაშვებულია');

  const id = await resolveTargetId(opts, prog, log);
  const gameDir = opts.gameDir || P.instances('shared');
  await U.mkdirp(gameDir);
  const { merged, clientJar, nativesDir, virtualAssets, java } = await installVersion(id, prog, log, gameDir);
  const javaPath = opts.javaPath || java;

  const { classpath } = libraryTargets(merged);
  // cpw.mods.bootstraplauncher (Forge/NeoForge ~1.17–1.20) რეალურ JPMS module path-საც (-p)
  // აწყობს და თავად ალაგებს "minecraft" მოდულს საკუთარი "client" ბიბლიოთეკიდან — თუ ვანილას
  // დაუმუშავებელ client.jar-საც დავამატებთ, ორივე ერთსა და იმავე პაკეტს აცხადებს და module
  // resolution ჩამოინგრევა (დადასტურებული რეალურ ტესტზე — 1.20.1 ასე გამოსწორდა).
  //
  // net.minecraftforge.bootstrap.ForgeBootstrap (26.x+) კი სულ სხვანაირად მუშაობს: რეალურ
  // launch args-ში (last-launch-args.log) საერთოდ არაა -p/module-path — მთლიანად ბრტყელი
  // -cp-ია, ანუ აქ JPMS კონფლიქტის რისკი არ არსებობს. FML თავად ეძებს Minecraft-ის კლასებს
  // classpath-ზე (getResource("net/minecraft/client/Minecraft.class") და მისნაირები) — მისი
  // გამორიცხვა უბრალოდ ამტვრევდა ამ ძებნას. ამიტომ მხოლოდ bootstraplauncher-ს ვუკლებთ.
  const usesModuleLauncher = merged.mainClass === 'cpw.mods.bootstraplauncher.BootstrapLauncher';
  const cp = (usesModuleLauncher
    ? classpath.filter((c) => c !== clientJar)
    : [...classpath.filter((c) => c !== clientJar), clientJar]
  ).join(path.delimiter);
  const ram = Math.max(1024, opts.ram || 4096);
  const name = (opts.playerName || 'Player').slice(0, 16);
  const uuid = U.offlineUuid(name);

  const vars = {
    auth_player_name: name,
    auth_uuid: uuid,
    uuid,
    auth_access_token: '0',
    auth_session: `token:0:${uuid.replace(/-/g, '')}`,
    auth_xuid: '0',
    clientid: '0',
    user_type: 'msa',
    user_properties: '{}',
    version_name: merged.id,
    version_type: merged.type,
    game_directory: gameDir,
    assets_root: P.assets(),
    game_assets: virtualAssets || P.assets('virtual', merged.assets || 'legacy'),
    assets_index_name: (merged.assetIndex && merged.assetIndex.id) || merged.assets || 'legacy',
    natives_directory: nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: cp,
    classpath_separator: path.delimiter,
    library_directory: P.libraries(),
    resolution_width: String(opts.width || 1280),
    resolution_height: String(opts.height || 720),
  };
  const features = { has_custom_resolution: Boolean(opts.width && opts.height), is_demo_user: false };

  const jvmTemplate = merged.arguments.jvm.length
    ? merged.arguments.jvm
    : ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'];

  const jvm = [
    `-Xmx${ram}M`,
    `-Xms${Math.min(1024, ram)}M`,
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+UseG1GC',
    '-XX:G1NewSizePercent=20',
    '-XX:MaxGCPauseMillis=50',
    '-Dfile.encoding=UTF-8',
    '-Dlog4j2.formatMsgNoLookups=true',
    `-Dminecraft.launcher.brand=${LAUNCHER_NAME}`,
    `-Dminecraft.launcher.version=${LAUNCHER_VERSION}`,
    // Forge-ის ახალი fmlloader-თაობები (net.minecraftforge.fml.loading.LibraryFinder)
    // ამ property-ს ითხოვენ პირდაპირ და მის გარეშე მცდარ, ფარდობით მდებარეობას ვარაუდობენ
    // (დადასტურებულია რეალურ crash-ში PrismLauncher-ის ერთ-ერთ Issue-ში).
    `-DlibraryDirectory=${vars.library_directory}`,
    ...(opts.extraJvm ? String(opts.extraJvm).split(/\s+/).filter(Boolean) : []),
    ...expandArgs(jvmTemplate, vars, features),
  ];
  // macOS + LWJGL3 (1.13+) ითხოვს ამ ფლაგს, ძველ ვერსიებზე კი პირიქით ტეხავს
  if (U.MC_OS === 'osx' && merged.arguments.jvm.length && !jvm.includes('-XstartOnFirstThread')) {
    jvm.unshift('-XstartOnFirstThread');
  }

  const gameArgs = expandArgs(
    merged.minecraftArguments ? merged.minecraftArguments.split(/\s+/) : merged.arguments.game,
    vars, features
  );
  if (opts.width && opts.height && !gameArgs.includes('--width')) {
    gameArgs.push('--width', String(opts.width), '--height', String(opts.height));
  }

  const args = [...jvm, merged.mainClass, ...gameArgs];
  prog('იწყება…', 0.98);
  log(`$ ${path.basename(javaPath)} … ${merged.mainClass}`);
  // სრული argument-ების log — ეკრანზე მოკლე ხაზი კმარა, მაგრამ crash-ის დროს
  // ამ ფაილში ზუსტად ჩანს რა classpath/module-path გაეშვა (auth token არ ინახება, offline='0').
  fsp.writeFile(path.join(gameDir, 'last-launch-args.log'), args.join('\n'), 'utf8').catch(() => {});

  const child = spawn(javaPath, args, { cwd: gameDir, detached: false });
  running = child;
  const pipe = (buf) => String(buf).split(/\r?\n/).forEach((l) => l.trim() && log(l.trim()));
  child.stdout.on('data', pipe);
  child.stderr.on('data', pipe);

  return new Promise((resolve, reject) => {
    let started = false;
    const ready = setTimeout(() => { started = true; prog('თამაში გაშვებულია', 1); resolve({ versionId: id, pid: child.pid }); }, 2500);
    child.on('error', (e) => { clearTimeout(ready); running = null; reject(e); });
    child.on('close', (code) => {
      clearTimeout(ready);
      running = null;
      onProgress({ stage: code === 0 ? 'თამაში დაიხურა' : `თამაში დაიხურა (კოდი ${code})`, pct: 0, exit: code });
      if (!started) {
        code === 0 ? resolve({ versionId: id, pid: null }) : reject(new Error(`თამაში ჩავარდა, კოდი ${code}. ჩახედე ლოგს.`));
      }
    });
  });
}

function stop() {
  if (running) { running.kill(); running = null; return true; }
  return false;
}
const isRunning = () => Boolean(running);

module.exports = {
  mcVersions, loaderVersions, listOptifineJars,
  resolveVersion, installVersion, ensureJava, launch, stop, isRunning,
};
