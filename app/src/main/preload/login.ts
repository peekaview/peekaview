import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  loginViaBrowser: (discardSession = false) => ipcRenderer.invoke('login-via-browser', discardSession),
  loginWithCode: (code: string) => ipcRenderer.invoke('login-with-code', code),
});

console.log('Preload script has been loaded');
