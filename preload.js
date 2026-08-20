'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, arg) => {
  const res = await ipcRenderer.invoke(channel, arg);
  if (!res || !res.ok) throw new Error((res && res.error) || 'უცნობი შეცდომა');
  return res.data;
};

contextBridge.exposeInMainWorld('rocket', {
  getConfig: () => call('config:get'),
  setConfig: (patch) => call('config:set', patch),
  getVersion: () => call('app:version'),

  mcVersions: (loader) => call('versions:mc', loader),
  loaderVersions: (loader, mc) => call('versions:loader', { loader, mc }),
  optifineJars: () => call('optifine:list'),

  launch: (opts) => call('launch', opts),
  stop: () => call('launch:stop'),
  isRunning: () => call('launch:state'),

  packsAvailable: () => call('packs:available'),
  packsInstalled: () => call('packs:installed'),
  installPack: (id) => call('packs:install', id),
  updatePack: (id) => call('packs:update', id),
  removePack: (id) => call('packs:remove', id),
  newPack: (name) => call('packs:scaffold', name),

  openPath: (target) => call('open:path', target),
  pickSkin: () => call('pick:skin'),
  clearSkin: () => call('skin:clear'),
  pickJava: () => call('pick:java'),

  on: (event, cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('evt:' + event, listener);
    return () => ipcRenderer.removeListener('evt:' + event, listener);
  },
});
