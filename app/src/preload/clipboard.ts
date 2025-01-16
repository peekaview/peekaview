import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  dataToClipboard: (callback: (data: string) => void) => ipcRenderer.on('data-to-clipboard', (_event, data) => callback(data)),
  clipboardReady: () => ipcRenderer.invoke('clipboard-ready'),
  closeClipboard: () => ipcRenderer.invoke('close-clipboard'),
})

console.log('Preload script has been loaded');
