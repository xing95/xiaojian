"use strict";

const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, input) => ipcRenderer.invoke(channel, input).then(result => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
});
contextBridge.exposeInMainWorld('xiaojian', {
  load: () => invoke('records:load'),
  save: data => invoke('records:save', data),
  info: () => invoke('records:info'),
  backup: () => invoke('records:backup'),
  preferences: input => invoke('records:preferences', input),
  chooseDataFolder: mode => invoke('records:choose-data', mode),
  chooseBackupFolder: () => invoke('records:choose-backup'),
  openFolder: kind => invoke('records:open-folder', kind)
});
