const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loginViaBrowser: () => ipcRenderer.invoke('login-via-browser'),
  loginWithCode: (code: string) => ipcRenderer.invoke('login-with-code', code),
});

console.log('Preload script has been loaded');
