import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

import { ScreenSource } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  onSendScreenSource: (callback: (source: ScreenSource) => void) => ipcRenderer.on('send-screen-source', (_event, source: ScreenSource) => callback(source)),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  logout: (discardSession = false) => ipcRenderer.invoke('logout', discardSession),
  handleAppClosing: () => ipcRenderer.invoke('handle-app-closing'),
  startRemoteControl: (hwnd: string, name: string) => ipcRenderer.invoke('start-remote-control', hwnd, name),
});

console.log('Preload script has been loaded');
