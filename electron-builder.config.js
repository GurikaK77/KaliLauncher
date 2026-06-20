const owner = process.env.GH_OWNER;
const repo  = process.env.GH_REPO;

let publish;
if (owner && repo) {
  publish = [{ provider: 'github', owner, repo, releaseType: 'release' }];
} else {
  publish = [{ provider: 'generic', url: 'https://example.com' }];
}

module.exports = {
  appId: 'com.gurika.kalilauncher',
  productName: 'KaliLauncher',
  asar: true,
  asarUnpack: ['modpack_files/**', 'assets/**', 'build/**'],
  files: ['main.js','renderer.js','index.html','style.css','assets/**','build/**','modpack_files/**'],
  directories: { output: 'dist', buildResources: 'build' },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icons/icon.ico'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build/icons/icon.ico',
    uninstallerIcon: 'build/icons/icon.ico',
    installerHeaderIcon: 'build/icons/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  },
  linux: {
    target: ['AppImage', 'deb'],
    icon: 'build/icons/512x512.png',
    category: 'Game'
  },
  publish
};
