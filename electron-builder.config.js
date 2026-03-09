const path = require('path');

const owner = process.env.GH_OWNER;
const repo = process.env.GH_REPO;
const updateUrl = process.env.UPDATE_URL;

let publish;
if (owner && repo) {
  publish = [{
    provider: 'github',
    owner,
    repo,
    releaseType: 'release'
  }];
} else if (updateUrl) {
  publish = [{
    provider: 'generic',
    url: updateUrl,
    channel: 'latest'
  }];
}

module.exports = {
  appId: 'com.kalilauncher.desktop',
  productName: 'KaliLauncher',
  copyright: 'Copyright © KaliLauncher',
  directories: {
    output: 'dist',
    buildResources: 'build'
  },
  files: [
    '**/*',
    '!dist/**',
    '!build/**/source/**',
    '!*.zip',
    '!*.log',
    '!**/*.bak',
    '!**/*.tmp',
    '!**/.DS_Store',
    '!**/Thumbs.db'
  ],
  asar: true,
  extraMetadata: {
    main: 'main.js'
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icons/icon.ico',
    artifactName: '${productName}-Setup-${version}.${ext}'
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] }
    ],
    icon: 'build/icons',
    category: 'Game',
    artifactName: '${productName}-${version}-${arch}.${ext}'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'KaliLauncher'
  },
  publish
};
