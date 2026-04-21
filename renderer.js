const { ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const RELEASE_VERSIONS = [
    '1.21.11', '1.21.10', '1.21.8', '1.21.4', '1.21.3', '1.21.1', '1.21',
    '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.20',
    '1.19.4', '1.19.3', '1.19.2', '1.19.1', '1.19',
    '1.18.2', '1.18.1', '1.18',
    '1.17.1', '1.17',
    '1.16.5', '1.16.4', '1.16.3', '1.16.2', '1.16.1',
    '1.15.2', '1.15.1', '1.15',
    '1.14.4', '1.14.3', '1.14.2', '1.14.1', '1.14',
    '1.13.2', '1.13.1', '1.13',
    '1.12.2'
];

const PROFILE_CONFIG = {
    tbilisi: {
        label: 'Tbilisi 2077',
        versions: ['1.20.1'],
        title: 'Tbilisi 2077',
        eyebrow: 'Curated modpack',
        description: 'A prebuilt pack that now runs from KaliLauncher\'s own isolated runtime, so your real Minecraft folder stays untouched.'
    },
    release: {
        label: 'Vanilla Release',
        versions: RELEASE_VERSIONS,
        title: 'Vanilla Release',
        eyebrow: 'Clean sandbox',
        description: 'A clean Minecraft install using KaliLauncher\'s private runtime with a separate game folder for each selected version.'
    },
    forge: {
        label: 'Forge',
        versions: RELEASE_VERSIONS,
        title: 'Forge Workspace',
        eyebrow: 'Mod loader',
        description: 'Forge versions install into the launcher runtime instead of sharing data with the official launcher or other launchers.'
    },
    fabric: {
        label: 'Fabric',
        versions: RELEASE_VERSIONS.filter((version) => /^1\.(1[4-9]|20|21)(\.|$)/.test(version)),
        title: 'Fabric Workspace',
        eyebrow: 'Lightweight loader',
        description: 'Fast Fabric profiles with isolated assets, libraries and versions managed only by KaliLauncher.'
    },
    optifine: {
        label: 'OptiFine',
        versions: RELEASE_VERSIONS,
        title: 'OptiFine Workspace',
        eyebrow: 'Performance profile',
        description: 'OptiFine installs into KaliLauncher\'s own runtime, which avoids collisions with any other Minecraft launcher on the machine.'
    }
};

const DEFAULT_CONFIG = {
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

const state = {
    config: structuredClone(DEFAULT_CONFIG),
    profileAssets: {
        profileRoot: '',
        customSkinPath: null
    },
    paths: {
        launcherDataRoot: '',
        minecraftRoot: '',
        systemMinecraftRoot: '',
        instancesRoot: '',
        profileRoot: '',
        currentProfile: ''
    },
    saveTimer: null,
    activeTab: 'play'
};

const usernameInput = document.getElementById('username');
const profileUsernameInput = document.getElementById('profile-username');
const profileSelect = document.getElementById('profile-select');
const versionSelect = document.getElementById('version-select');
const memoryMaxInput = document.getElementById('memory-max');
const memoryMinInput = document.getElementById('memory-min');
const resolutionWidthInput = document.getElementById('resolution-width');
const resolutionHeightInput = document.getElementById('resolution-height');
const fullscreenInput = document.getElementById('fullscreen');
const closeBehaviorSelect = document.getElementById('close-behavior');
const playBtn = document.getElementById('play-btn');
const footerAvatar = document.getElementById('footer-avatar');
const profileHeadPreview = document.getElementById('profile-head-preview');
const profileSkinImage = document.getElementById('profile-skin-image');
const profileDisplayName = document.getElementById('profile-display-name');
const profileSkinStatus = document.getElementById('profile-skin-status');
const profileSkinPath = document.getElementById('profile-skin-path');
const heroEyebrow = document.getElementById('hero-eyebrow');
const heroTitle = document.getElementById('hero-title');
const heroDescription = document.getElementById('hero-description');
const heroStatusLine = document.getElementById('hero-status-line');
const statusPill = document.getElementById('status-pill');
const heroProfileLabel = document.getElementById('hero-profile-label');
const heroVersionLabel = document.getElementById('hero-version-label');
const heroRuntimeMode = document.getElementById('hero-runtime-mode');
const sidebarRuntimeMode = document.getElementById('sidebar-runtime-mode');
const launcherDataShort = document.getElementById('launcher-data-short');
const launcherDataPath = document.getElementById('launcher-data-path');
const currentFolderLabel = document.getElementById('current-folder-label');
const currentFolderPath = document.getElementById('current-folder-path');
const isolationSummary = document.getElementById('isolation-summary');
const footerProfileLabel = document.getElementById('footer-profile-label');
const footerVersionLabel = document.getElementById('footer-version-label');
const navItems = [...document.querySelectorAll('.nav-menu li')];
const tabs = {
    play: document.getElementById('tab-play'),
    profile: document.getElementById('tab-profile'),
    settings: document.getElementById('tab-settings'),
    tools: document.getElementById('tab-tools')
};

function deepMerge(base, extra) {
    const output = Array.isArray(base) ? [...base] : { ...base };
    for (const [key, value] of Object.entries(extra || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
            output[key] = deepMerge(base[key], value);
        } else {
            output[key] = value;
        }
    }
    return output;
}

function sanitizeConfig(raw) {
    const merged = deepMerge(DEFAULT_CONFIG, raw || {});
    merged.username = String(merged.username || DEFAULT_CONFIG.username).replace(/\s+/g, ' ').trim().slice(0, 16) || DEFAULT_CONFIG.username;
    merged.selectedProfile = PROFILE_CONFIG[merged.selectedProfile] ? merged.selectedProfile : DEFAULT_CONFIG.selectedProfile;
    merged.selectedVersions = { ...DEFAULT_CONFIG.selectedVersions, ...(merged.selectedVersions || {}) };

    const settings = merged.settings || {};
    const maxMemory = Math.min(32, Math.max(2, Number(settings.memoryMax) || DEFAULT_CONFIG.settings.memoryMax));
    const minMemory = Math.min(maxMemory, Math.max(1, Number(settings.memoryMin) || DEFAULT_CONFIG.settings.memoryMin));
    merged.settings = {
        memoryMax: maxMemory,
        memoryMin: minMemory,
        resolutionWidth: Math.min(3840, Math.max(854, Number(settings.resolutionWidth) || DEFAULT_CONFIG.settings.resolutionWidth)),
        resolutionHeight: Math.min(2160, Math.max(480, Number(settings.resolutionHeight) || DEFAULT_CONFIG.settings.resolutionHeight)),
        fullscreen: Boolean(settings.fullscreen),
        closeBehavior: ['hide', 'minimize', 'stay'].includes(settings.closeBehavior) ? settings.closeBehavior : DEFAULT_CONFIG.settings.closeBehavior
    };

    return merged;
}

function currentProfileConfig() {
    return PROFILE_CONFIG[state.config.selectedProfile] || PROFILE_CONFIG.tbilisi;
}

function currentSelectedVersion() {
    const config = currentProfileConfig();
    return state.config.selectedVersions[state.config.selectedProfile] || config.versions[0];
}

function setText(element, value) {
    if (element) element.textContent = value;
}

function formatShortPath(filePath) {
    if (!filePath) return 'Unavailable';
    const normalized = path.normalize(filePath);
    const parts = normalized.split(path.sep).filter(Boolean);
    if (parts.length <= 3) return normalized;
    return `...${path.sep}${parts.slice(-3).join(path.sep)}`;
}

function switchTab(tab) {
    state.activeTab = tab;
    navItems.forEach((item) => item.classList.toggle('active', item.dataset.tab === tab));
    Object.entries(tabs).forEach(([name, el]) => el.classList.toggle('hidden', name !== tab));
}

function resolveStatusTone(text) {
    const normalized = String(text || '').toLowerCase();
    if (/error|fail|err/.test(normalized)) return 'error';
    if (/update|download|checking|progress|upd|new|info/.test(normalized)) return 'info';
    if (/start|launch|work|skin|reset|asset/.test(normalized)) return 'accent';
    return 'ready';
}

function updateHeroStatus(message, pill = 'READY') {
    setText(heroStatusLine, message);
    setText(statusPill, pill);
    if (statusPill) statusPill.dataset.state = resolveStatusTone(`${message} ${pill}`);
}

function populateProfiles() {
    profileSelect.innerHTML = '';
    Object.entries(PROFILE_CONFIG).forEach(([value, config]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = config.label;
        profileSelect.appendChild(option);
    });
}

function populateVersions() {
    const profile = state.config.selectedProfile;
    const config = currentProfileConfig();
    const selectedVersion = state.config.selectedVersions[profile] || config.versions[0];

    versionSelect.innerHTML = '';
    config.versions.forEach((version) => {
        const option = document.createElement('option');
        option.value = version;
        option.textContent = version;
        versionSelect.appendChild(option);
    });

    versionSelect.value = config.versions.includes(selectedVersion) ? selectedVersion : config.versions[0];
    state.config.selectedVersions[profile] = versionSelect.value;
}

function applyUsernameToInputs() {
    usernameInput.value = state.config.username;
    if (profileUsernameInput) profileUsernameInput.value = state.config.username;
    if (profileDisplayName) profileDisplayName.textContent = state.config.username;
}

function toFileUrl(filePath) {
    return `${pathToFileURL(filePath).href}?t=${Date.now()}`;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });
}

async function createHeadDataUrlFromSkin(skinPath, scale = 8) {
    const image = await loadImage(toFileUrl(skinPath));
    const canvas = document.createElement('canvas');
    const size = 8 * scale;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, 8, 8, 8, 8, 0, 0, size, size);
    try {
        ctx.drawImage(image, 40, 8, 8, 8, 0, 0, size, size);
    } catch (error) {
        console.warn('Hat layer preview failed:', error);
    }
    return canvas.toDataURL('image/png');
}

async function updateAvatar() {
    const username = encodeURIComponent(state.config.username || 'KaliPlayer');
    const customSkinPath = state.profileAssets?.customSkinPath;

    if (customSkinPath) {
        try {
            const footerHead = await createHeadDataUrlFromSkin(customSkinPath, 5);
            const profileHead = await createHeadDataUrlFromSkin(customSkinPath, 16);
            if (footerAvatar) footerAvatar.src = footerHead;
            if (profileHeadPreview) profileHeadPreview.src = profileHead;
            if (profileSkinImage) profileSkinImage.src = toFileUrl(customSkinPath);
            if (profileSkinStatus) profileSkinStatus.textContent = 'Custom skin loaded';
            if (profileSkinPath) profileSkinPath.textContent = customSkinPath;
            return;
        } catch (error) {
            console.error('Failed to render custom skin preview:', error);
        }
    }

    const cacheBust = `?t=${Date.now()}`;
    if (footerAvatar) footerAvatar.src = `https://minotar.net/avatar/${username}/40${cacheBust}`;
    if (profileHeadPreview) profileHeadPreview.src = `https://minotar.net/helm/${username}/160${cacheBust}`;
    if (profileSkinImage) profileSkinImage.src = `https://minotar.net/skin/${username}${cacheBust}`;
    if (profileSkinStatus) profileSkinStatus.textContent = 'Default skin preview';
    if (profileSkinPath) profileSkinPath.textContent = 'No custom skin selected';
}

async function refreshProfileAssets() {
    try {
        state.profileAssets = await ipcRenderer.invoke('get-profile-assets');
    } catch (error) {
        console.error('Failed to load profile assets:', error);
        state.profileAssets = { profileRoot: '', customSkinPath: null };
    }
    await updateAvatar();
}

function updatePathUI() {
    const profile = currentProfileConfig();
    const selectedVersion = currentSelectedVersion();
    const runtimePath = state.paths.minecraftRoot;
    const currentPath = state.paths.currentProfile;
    const systemPath = state.paths.systemMinecraftRoot;

    setText(heroProfileLabel, profile.label);
    setText(heroVersionLabel, selectedVersion);
    setText(heroRuntimeMode, 'Isolated');
    setText(sidebarRuntimeMode, 'Isolated');
    setText(launcherDataShort, formatShortPath(runtimePath || state.paths.launcherDataRoot));
    setText(launcherDataPath, runtimePath || 'Launcher runtime path unavailable');
    setText(currentFolderLabel, `${profile.label} / ${selectedVersion}`);
    setText(currentFolderPath, currentPath || 'Current instance path unavailable');
    setText(footerProfileLabel, profile.label);
    setText(footerVersionLabel, selectedVersion);

    if (runtimePath && systemPath) {
        setText(isolationSummary, `KaliLauncher now uses ${formatShortPath(runtimePath)} instead of the shared system folder ${formatShortPath(systemPath)}.`);
    } else {
        setText(isolationSummary, 'Versions, libraries and assets stay inside KaliLauncher only.');
    }
}

async function refreshLauncherPaths() {
    try {
        state.paths = await ipcRenderer.invoke('get-launcher-paths', {
            profile: state.config.selectedProfile,
            version: currentSelectedVersion()
        });
    } catch (error) {
        console.error('Failed to load launcher paths:', error);
        state.paths = {
            launcherDataRoot: '',
            minecraftRoot: '',
            systemMinecraftRoot: '',
            instancesRoot: '',
            profileRoot: '',
            currentProfile: ''
        };
    }
    updatePathUI();
}

function applyConfigToUI() {
    state.config = sanitizeConfig(state.config);
    const profile = state.config.selectedProfile;
    const config = currentProfileConfig();

    applyUsernameToInputs();
    profileSelect.value = profile;
    populateVersions();

    setText(heroEyebrow, config.eyebrow);
    setText(heroTitle, config.title);
    setText(heroDescription, config.description);
    memoryMaxInput.value = state.config.settings.memoryMax;
    memoryMinInput.value = state.config.settings.memoryMin;
    resolutionWidthInput.value = state.config.settings.resolutionWidth;
    resolutionHeightInput.value = state.config.settings.resolutionHeight;
    fullscreenInput.checked = state.config.settings.fullscreen;
    closeBehaviorSelect.value = state.config.settings.closeBehavior;
    updatePathUI();
}

async function persistConfig(immediate = false) {
    clearTimeout(state.saveTimer);
    if (!immediate) {
        state.saveTimer = setTimeout(() => persistConfig(true), 250);
        return;
    }

    state.config = sanitizeConfig(state.config);
    state.config = await ipcRenderer.invoke('save-launcher-config', state.config);
    applyConfigToUI();
}

function setLaunchingState(isLaunching, text = 'Launch') {
    playBtn.disabled = isLaunching;
    playBtn.classList.toggle('loading', isLaunching);
    playBtn.textContent = text;
}

function handleUsernameChange(nextValue) {
    state.config.username = String(nextValue).replace(/\s+/g, ' ').trimStart().slice(0, 16);
    applyUsernameToInputs();
    updateAvatar();
    persistConfig();
}

function bindEvents() {
    navItems.forEach((item) => item.addEventListener('click', () => switchTab(item.dataset.tab)));

    usernameInput.addEventListener('input', () => handleUsernameChange(usernameInput.value));
    if (profileUsernameInput) {
        profileUsernameInput.addEventListener('input', () => handleUsernameChange(profileUsernameInput.value));
    }

    profileSelect.addEventListener('change', () => {
        state.config.selectedProfile = profileSelect.value;
        applyConfigToUI();
        void refreshLauncherPaths();
        persistConfig();
    });

    versionSelect.addEventListener('change', () => {
        state.config.selectedVersions[state.config.selectedProfile] = versionSelect.value;
        updatePathUI();
        void refreshLauncherPaths();
        persistConfig();
    });

    [[memoryMaxInput, 'memoryMax'], [memoryMinInput, 'memoryMin'], [resolutionWidthInput, 'resolutionWidth'], [resolutionHeightInput, 'resolutionHeight']].forEach(([input, key]) => {
        input.addEventListener('change', () => {
            state.config.settings[key] = Number(input.value);
            persistConfig();
        });
    });

    fullscreenInput.addEventListener('change', () => {
        state.config.settings.fullscreen = fullscreenInput.checked;
        persistConfig();
    });

    closeBehaviorSelect.addEventListener('change', () => {
        state.config.settings.closeBehavior = closeBehaviorSelect.value;
        persistConfig();
    });

    document.getElementById('java17-btn').addEventListener('click', () => ipcRenderer.send('open-java-download', '17'));
    document.getElementById('java21-btn').addEventListener('click', () => ipcRenderer.send('open-java-download', '21'));
    document.getElementById('go-profile-btn').addEventListener('click', () => switchTab('profile'));
    document.getElementById('open-minecraft-folder-btn').addEventListener('click', () => ipcRenderer.invoke('open-launcher-folder', 'minecraftRoot'));
    document.getElementById('open-instances-folder-btn').addEventListener('click', () => ipcRenderer.invoke('open-launcher-folder', 'instancesRoot'));
    document.getElementById('open-current-folder-btn').addEventListener('click', () => {
        ipcRenderer.invoke('open-launcher-folder', 'currentProfile', {
            profile: state.config.selectedProfile,
            version: currentSelectedVersion()
        });
    });
    document.getElementById('open-tbilisi-folder-btn').addEventListener('click', () => ipcRenderer.invoke('open-launcher-folder', 'tbilisiRoot'));
    document.getElementById('open-minecraft-root-btn').addEventListener('click', () => ipcRenderer.invoke('open-launcher-folder', 'minecraftRoot'));
    document.getElementById('open-launcher-root-btn').addEventListener('click', () => ipcRenderer.invoke('open-launcher-folder', 'launcherRoot'));
    document.getElementById('open-profile-folder-btn').addEventListener('click', () => ipcRenderer.invoke('open-launcher-folder', 'profileRoot'));

    document.getElementById('upload-skin-btn').addEventListener('click', async () => {
        const result = await ipcRenderer.invoke('select-custom-skin');
        if (result?.cancelled) return;
        if (result?.ok === false) {
            alert(result?.error || 'Failed to set custom skin');
            return;
        }
        await refreshProfileAssets();
        updateHeroStatus('Custom skin saved', 'SKIN');
    });

    document.getElementById('remove-skin-btn').addEventListener('click', async () => {
        const result = await ipcRenderer.invoke('clear-custom-skin');
        if (result?.ok === false) {
            alert(result?.error || 'Failed to remove custom skin');
            return;
        }
        await refreshProfileAssets();
        updateHeroStatus('Custom skin removed', 'SKIN');
    });

    document.getElementById('check-updates-btn').addEventListener('click', async () => {
        const result = await ipcRenderer.invoke('check-for-updates');
        if (result?.ok === false && result?.reason) {
            updateHeroStatus(result.reason, 'INFO');
            alert(result.reason);
        } else {
            updateHeroStatus('Checking for updates...', 'UPD');
        }
    });

    document.getElementById('reset-settings-btn').addEventListener('click', async () => {
        state.config = await ipcRenderer.invoke('reset-launcher-config');
        applyConfigToUI();
        await refreshProfileAssets();
        await refreshLauncherPaths();
        updateHeroStatus('Defaults restored', 'RESET');
    });

    playBtn.addEventListener('click', async () => {
        await persistConfig(true);
        const selectedVersion = currentSelectedVersion();
        setLaunchingState(true, 'Launching...');
        updateHeroStatus(`${currentProfileConfig().label} ${selectedVersion}`, 'START');
        ipcRenderer.send('launch-game', {
            username: state.config.username,
            profile: state.config.selectedProfile,
            version: selectedVersion,
            settings: state.config.settings
        });
    });
}

ipcRenderer.on('download-progress', (_event, progress) => {
    if (progress.message) {
        setLaunchingState(true, progress.message);
        updateHeroStatus(progress.message, 'WORK');
        return;
    }
    if (progress.type === 'progress') {
        const text = `DOWNLOADING ${Math.round(progress.percent)}%`;
        setLaunchingState(true, text);
        updateHeroStatus(text, 'DL');
        return;
    }
    if (progress.type === 'assets') {
        const text = `ASSETS ${progress.task}/${progress.total}`;
        setLaunchingState(true, text);
        updateHeroStatus(text, 'ASSET');
    }
});

ipcRenderer.on('game-closed', () => {
    setLaunchingState(false, 'Launch');
    updateHeroStatus('Ready', 'READY');
});

ipcRenderer.on('launch-error', (_event, message) => {
    setLaunchingState(false, 'Launch');
    updateHeroStatus('Launch failed', 'ERROR');
    alert(`Error: ${message}`);
});

ipcRenderer.on('updater-status', (_event, payload) => {
    if (!payload) return;
    const message = payload.message || 'Updater';
    const pill = payload.pill || 'UPD';
    updateHeroStatus(message, pill);
    if (payload.type === 'downloaded') {
        alert('A new launcher update has been downloaded. Close the launcher when you are ready to install it.');
    }
});

async function initialize() {
    populateProfiles();
    bindEvents();

    try {
        state.config = sanitizeConfig(await ipcRenderer.invoke('get-launcher-config'));
    } catch (error) {
        console.error(error);
        state.config = sanitizeConfig(DEFAULT_CONFIG);
    }

    applyConfigToUI();
    await refreshProfileAssets();
    await refreshLauncherPaths();
    switchTab('play');
    setLaunchingState(false, 'Launch');
    updateHeroStatus('Ready', 'READY');
}

initialize();
