import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'
import { ElectronWindowDimensions } from '../interface';

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  dataToClipboard: (callback: (data: string) => void) => ipcRenderer.on('data-to-clipboard', (_event, data) => callback(data)),
  clipboardReady: () => ipcRenderer.invoke('clipboard-ready'),
  resizeWindow: (windowName: string, dimensions: ElectronWindowDimensions) => ipcRenderer.invoke('resize-window', windowName, dimensions),
  closeClipboard: () => ipcRenderer.invoke('close-clipboard'),
})

console.log('Preload script has been loaded');
