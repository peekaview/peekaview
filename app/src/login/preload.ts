const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loginViaBrowser: (discardSession = false) => ipcRenderer.invoke('login-via-browser', discardSession),
  loginWithCode: (code: string) => ipcRenderer.invoke('login-with-code', code),
});

console.log('Preload script has been loaded');
