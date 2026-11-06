const { contextBridge, ipcRenderer, webUtils } = require('electron');
const calls = ['importAudio', 'importDroppedFiles', 'saveProject', 'openProject', 'exportAudio', 'processAudio', 'recoverProject', 'autosave', 'setLanguage', 'openMicrophoneSettings'];
contextBridge.exposeInMainWorld('desktop', {
  ...Object.fromEntries(calls.map(name => [name, (...args) => ipcRenderer.invoke(name, ...args)])),
  platform: process.platform,
  pathsForFiles: files => Array.from(files, file => webUtils.getPathForFile(file)).filter(Boolean)
});
