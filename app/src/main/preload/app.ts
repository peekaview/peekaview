import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  onSendScreenSourceId: (callback: (id: string) => void) => ipcRenderer.on('send-screen-source-id', (_event, id: string) => callback(id)),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  logout: (discardSession = false) => ipcRenderer.invoke('logout', discardSession),
  handleAppClosing: () => ipcRenderer.invoke('handle-app-closing'),
});

console.log('Preload script has been loaded');
