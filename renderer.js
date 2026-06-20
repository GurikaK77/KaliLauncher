'use strict';
const { ipcRenderer } = require('electron');

// ─── State ─────────────────────────────────────────────────────────────────────
let config = { username: 'KaliPlayer', settings: {} };
let hub    = { library: [], resources: [] };
let launching = false;

// ─── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
    config = await ipcRenderer.invoke('get-config');
    hub    = await ipcRenderer.invoke('get-hub');
    const profile = await ipcRenderer.invoke('get-profile');

    applyConfig();
    renderLibrary();
    renderResources();
    applySkin(profile);
    bindNav();
    bindSettings();
    bindPlayerCard();
    bindQuickPlay();
    listenEvents();
    updateVersionLabel();
})();

// ─── Quick Play ────────────────────────────────────────────────────────────────
let mcVersionsCache = null;

async function loadVersionsInto(selectEl) {
    selectEl.innerHTML = '<option value="">Loading versions...</option>';
    if (!mcVersionsCache) {
        const res = await ipcRenderer.invoke('get-mc-versions');
        if (!res.ok) {
            selectEl.innerHTML = '<option value="">Failed to load</option>';
            return;
        }
        mcVersionsCache = res.versions;
    }
    selectEl.innerHTML = mcVersionsCache.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function bindQuickPlay() {
    const loaderSel = ge('qpLoader');
    const versionSel = ge('qpVersion');
    const playBtn = ge('qpPlayBtn');
    if (!loaderSel || !versionSel || !playBtn) return;

    loadVersionsInto(versionSel);

    playBtn.addEventListener('click', async () => {
        if (launching) return;
        const loader = loaderSel.value;
        const mcVersion = versionSel.value;
        if (!mcVersion) { toast('Pick a version first', 'error'); return; }

        launching = true;
        const savedCfg = await ipcRenderer.invoke('save-config', {
            username: val('usernameInput') || config.username,
            settings: readSettings()
        });
        config = savedCfg;
        applyConfig();
        showOverlay(`Preparing ${loader} ${mcVersion}...`);
        const res = await ipcRenderer.invoke('quick-launch', {
            loader, mcVersion, username: config.username, settings: config.settings
        });
        if (!res.ok) {
            hideOverlay();
            launching = false;
            toast(`Launch failed: ${res.error}`, 'error');
        }
    });
}

// ─── Navigation ────────────────────────────────────────────────────────────────
function bindNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`page-${btn.dataset.page}`)?.classList.add('active');
        });
    });
}

// ─── Config ────────────────────────────────────────────────────────────────────
function applyConfig() {
    const s = config.settings || {};
    setText('playerName', config.username || 'KaliPlayer');
    setValue('usernameInput', config.username || 'KaliPlayer');
    setValue('memMax', s.memoryMax ?? 6);
    setValue('memMin', s.memoryMin ?? 2);
    setValue('resW', s.resolutionWidth ?? 1280);
    setValue('resH', s.resolutionHeight ?? 720);
    setChecked('fullscreen', !!s.fullscreen);
    setValue('closeBehavior', s.closeBehavior || 'hide');
}

function readSettings() {
    return {
        memoryMax: Number(val('memMax')) || 6,
        memoryMin: Number(val('memMin')) || 2,
        resolutionWidth: Number(val('resW')) || 1280,
        resolutionHeight: Number(val('resH')) || 720,
        fullscreen: checked('fullscreen'),
        closeBehavior: val('closeBehavior') || 'hide'
    };
}

// ─── Library ───────────────────────────────────────────────────────────────────
function renderLibrary() {
    const grid = ge('libraryGrid');
    if (!hub.library?.length) {
        grid.innerHTML = `<div class="empty-state">
            <i class="fas fa-box-open"></i>
            <p>No modpacks installed yet.<br>Go to <strong>Resources</strong> to download one.</p>
        </div>`;
        return;
    }
    grid.innerHTML = hub.library.map(pack => packCard(pack, 'library')).join('');
    bindPackActions(grid, 'library');
}

function renderResources() {
    const grid = ge('resourcesGrid');
    grid.innerHTML = hub.resources.map(pack => packCard(pack, 'resource')).join('');
    bindPackActions(grid, 'resource');
}

function packCard(pack, ctx) {
    const isLib = ctx === 'library';
    const coming = pack.status === 'coming-soon';
    const loader = (pack.loader || '').toLowerCase();
    const loaderLabel = loader === 'fabric' ? 'Fabric' : loader === 'forge' ? 'Forge' : '';
    const mcVer = pack.mcVersion || '';
    const mods = pack.modCount > 0 ? `<span class="chip"><i class="fas fa-puzzle-piece"></i>${pack.modCount} mods</span>` : '';
    const cfg  = pack.hasConfig  ? `<span class="chip"><i class="fas fa-sliders"></i>Config</span>` : '';

    let coverHtml = '';
    if (pack.coverPath && require('fs').existsSync(pack.coverPath)) {
        const ext = require('path').extname(pack.coverPath).toLowerCase();
        if (ext === '.svg') {
            try {
                const svg = require('fs').readFileSync(pack.coverPath, 'utf8');
                coverHtml = svg;
            } catch { coverHtml = iconCover(pack.icon); }
        } else {
            coverHtml = `<img src="${esc(pack.coverPath)}?t=${Date.now()}" alt="${esc(pack.name)}">`;
        }
    } else {
        coverHtml = iconCover(pack.icon);
    }

    const badge = loaderLabel
        ? `<span class="pack-loader-badge ${loader}">${loaderLabel} ${mcVer}</span>`
        : '';

    let actions = '';
    if (coming) {
        actions = `<button class="btn-ghost" disabled><i class="fas fa-clock"></i> Coming Soon</button>`;
    } else if (isLib) {
        actions = `
            <button class="btn-primary full" data-action="launch" data-id="${esc(pack.id)}"><i class="fas fa-play"></i> Play</button>
            <button class="btn-ghost" data-action="open-installed" data-id="${esc(pack.id)}" title="Open folder"><i class="fas fa-folder-open"></i></button>
            <button class="btn-ghost danger" data-action="delete" data-id="${esc(pack.id)}" title="Delete"><i class="fas fa-trash"></i></button>
        `;
    } else {
        const downloaded = pack.installed;
        actions = `
            <button class="btn-primary full" data-action="install" data-id="${esc(pack.id)}">
                <i class="fas fa-cloud-arrow-down"></i> ${downloaded ? 'Update' : 'Download'}
            </button>
            <button class="btn-ghost" data-action="open-source" data-id="${esc(pack.id)}" title="Source folder"><i class="fas fa-folder-open"></i></button>
        `;
    }

    return `<div class="pack-card${coming ? ' coming-soon' : ''}">
        <div class="pack-cover">${coverHtml}${badge}</div>
        <div class="pack-body">
            <span class="pack-by">By ${esc(pack.author || 'Gurika').toUpperCase()}</span>
            <span class="pack-name">${esc(pack.name)}</span>
            <div class="pack-chips">${mods}${cfg}</div>
            <div class="pack-actions">${actions}</div>
        </div>
    </div>`;
}

function iconCover(icon) {
    return `<div class="pack-cover-icon"><i class="fas ${esc(icon || 'fa-cube')}"></i></div>`;
}

function bindPackActions(grid, ctx) {
    grid.addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action === 'launch')        await doLaunch(id);
        else if (action === 'install')  await doInstall(id);
        else if (action === 'delete')   await doDelete(id);
        else if (action === 'open-installed') ipcRenderer.invoke('open-folder', 'packInstalled', { packId: id });
        else if (action === 'open-source')    ipcRenderer.invoke('open-folder', 'packSource', { packId: id });
    });
}

// ─── Actions ───────────────────────────────────────────────────────────────────
async function doLaunch(packId) {
    if (launching) return;
    launching = true;
    const savedCfg = await ipcRenderer.invoke('save-config', {
        username: val('usernameInput') || config.username,
        settings: readSettings()
    });
    config = savedCfg;
    applyConfig();
    showOverlay('Preparing...');
    const res = await ipcRenderer.invoke('launch-pack', {
        packId,
        username: config.username,
        settings: config.settings
    });
    if (!res.ok) {
        hideOverlay();
        launching = false;
        toast(`Launch failed: ${res.error}`, 'error');
    }
}

async function doInstall(packId) {
    const btn = document.querySelector(`[data-action="install"][data-id="${packId}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...'; }
    const res = await ipcRenderer.invoke('install-pack', packId);
    if (res.ok) {
        hub = await ipcRenderer.invoke('get-hub');
        renderLibrary();
        renderResources();
        toast(`${res.pack?.name || packId} downloaded!`, 'success');
    } else {
        toast(`Download failed: ${res.error}`, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-arrow-down"></i> Download'; }
    }
}

async function doDelete(packId) {
    const pack = hub.library.find(p => p.id === packId);
    if (!confirm(`Delete "${pack?.name || packId}" from your library?`)) return;
    const res = await ipcRenderer.invoke('delete-pack', packId);
    if (res.ok) {
        hub = await ipcRenderer.invoke('get-hub');
        renderLibrary();
        renderResources();
        toast('Modpack deleted', 'success');
    } else {
        toast(`Delete failed: ${res.error}`, 'error');
    }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function bindSettings() {
    ge('saveSettingsBtn')?.addEventListener('click', async () => {
        const newCfg = {
            username: val('usernameInput') || 'KaliPlayer',
            settings: readSettings()
        };
        config = await ipcRenderer.invoke('save-config', newCfg);
        applyConfig();
        toast('Settings saved', 'success');
    });

    ge('selectSkinBtn')?.addEventListener('click', async () => {
        const res = await ipcRenderer.invoke('select-skin');
        if (res.ok) { applySkin(res); toast('Skin updated', 'success'); }
    });

    ge('clearSkinBtn')?.addEventListener('click', async () => {
        const res = await ipcRenderer.invoke('clear-skin');
        applySkin(res);
        toast('Skin removed', 'success');
    });

    ge('checkUpdatesBtn')?.addEventListener('click', async () => {
        const res = await ipcRenderer.invoke('check-updates');
        toast(res.ok ? 'Checking for updates...' : res.error, res.ok ? 'success' : 'error');
    });

    ge('openDataBtn')?.addEventListener('click', () => ipcRenderer.invoke('open-folder', 'data'));
    ge('openMCBtn')?.addEventListener('click', () => ipcRenderer.invoke('open-folder', 'mcRoot'));
    ge('openPackFilesBtn')?.addEventListener('click', () => ipcRenderer.invoke('open-folder', 'packFiles'));

    ge('refreshLibraryBtn')?.addEventListener('click', async () => {
        hub = await ipcRenderer.invoke('get-hub');
        renderLibrary();
    });

    ge('refreshResourcesBtn')?.addEventListener('click', async () => {
        hub = await ipcRenderer.invoke('get-hub');
        renderResources();
    });
}

function bindPlayerCard() {
    ge('playerCard')?.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-page="settings"]')?.classList.add('active');
        document.getElementById('page-settings')?.classList.add('active');
    });
}

// ─── Skin ─────────────────────────────────────────────────────────────────────
function applySkin(profile) {
    const preview = ge('skinPreview');
    const avatar  = ge('playerAvatar');
    if (!profile?.hasSkin || !profile?.skinPath) {
        if (preview) preview.innerHTML = '<i class="fas fa-user"></i>';
        if (avatar)  avatar.innerHTML  = '<i class="fas fa-user"></i>';
        return;
    }
    const url = `file://${profile.skinPath}?t=${Date.now()}`;
    if (preview) preview.innerHTML = `<img src="${url}" alt="skin">`;
    if (avatar)  avatar.innerHTML  = `<img src="${url}" alt="skin">`;
}

// ─── Events ────────────────────────────────────────────────────────────────────
function listenEvents() {
    ipcRenderer.on('status', (_, msg) => {
        setText('launchStatus', msg);
    });

    ipcRenderer.on('launch-error', (_, msg) => {
        hideOverlay();
        launching = false;
        toast(`Error: ${msg}`, 'error');
    });

    ipcRenderer.on('game-closed', () => {
        hideOverlay();
        launching = false;
    });

    let pendingUpdateVersion = null;
    let updateModalDismissed = false;

    ipcRenderer.on('updater', (_, { type, msg, version, percent }) => {
        const bar = ge('updaterBar');
        if (!bar) return;
        bar.classList.remove('hidden', 'error', 'ready');
        const icon = bar.querySelector('i');
        const txt  = ge('updaterMsg');

        if (type === 'none') { bar.classList.add('hidden'); return; }

        if (type === 'error') {
            bar.classList.add('error');
            if (icon) icon.className = 'fas fa-triangle-exclamation';
        } else if (type === 'ready') {
            bar.classList.add('ready');
            if (icon) icon.className = 'fas fa-circle-check';
            pendingUpdateVersion = version || '';
            if (!updateModalDismissed) showUpdateModal(pendingUpdateVersion);
        } else {
            if (icon) icon.className = 'fas fa-rotate fa-spin';
        }

        if (txt) txt.textContent = msg;
    });

    ge('updaterBar')?.addEventListener('click', () => {
        if (ge('updaterBar')?.classList.contains('ready')) showUpdateModal(pendingUpdateVersion);
    });

    ge('updateInstallBtn')?.addEventListener('click', () => {
        ipcRenderer.invoke('install-update');
    });

    ge('updateLaterBtn')?.addEventListener('click', () => {
        updateModalDismissed = true;
        hideUpdateModal();
    });

    ge('cancelLaunchBtn')?.addEventListener('click', () => {
        // Can't truly cancel Forge download mid-way, but hide overlay
        hideOverlay();
        launching = false;
    });
}

// ─── Overlay / Toast ──────────────────────────────────────────────────────────
function showOverlay(msg = 'Launching...') {
    setText('launchStatus', msg);
    ge('launchOverlay')?.classList.remove('hidden');
}

function hideOverlay() {
    ge('launchOverlay')?.classList.add('hidden');
}

function showUpdateModal(version) {
    setText('updateVersionText', version ? `Version ${version}` : 'A new version');
    ge('updateOverlay')?.classList.remove('hidden');
}

function hideUpdateModal() {
    ge('updateOverlay')?.classList.add('hidden');
}

let toastTimer = null;
function toast(msg, type = '') {
    const el = ge('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast${type ? ' ' + type : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function updateVersionLabel() {
    const el = ge('versionLabel');
    if (el) {
        try {
            const pkg = require('./package.json');
            el.textContent = `v${pkg.version}`;
        } catch {}
    }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const ge = id => document.getElementById(id);
const val = id => { const e = ge(id); return e ? e.value : ''; };
const checked = id => { const e = ge(id); return e ? e.checked : false; };
const setText  = (id, v) => { const e = ge(id); if (e) e.textContent = v; };
const setValue = (id, v) => { const e = ge(id); if (e) e.value = v; };
const setChecked = (id, v) => { const e = ge(id); if (e) e.checked = v; };
const esc = v => String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
