const { contextBridge, ipcRenderer } = require('electron');
const calls = ['importAudio', 'saveProject', 'openProject', 'exportAudio', 'processAudio', 'recoverProject', 'autosave', 'setLanguage'];
contextBridge.exposeInMainWorld('desktop', Object.fromEntries(calls.map(name => [name, (...args) => ipcRenderer.invoke(name, ...args)])));
