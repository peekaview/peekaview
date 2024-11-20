import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  onSendScreenSourceId: (callback: (id: string, name: string) => void) => ipcRenderer.on('send-screen-source-id', (_event, id: string, name: string) => callback(id, name)),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  logout: (discardSession = false) => ipcRenderer.invoke('logout', discardSession),
  handleAppClosing: () => ipcRenderer.invoke('handle-app-closing'),
  startRemoteControl: (hwnd: string, name: string) => ipcRenderer.invoke('start-remote-control', hwnd, name),
});

console.log('Preload script has been loaded');
