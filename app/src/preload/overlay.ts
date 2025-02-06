import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'
import { RemoteMouseData, OverlayData } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  onMouseDown: (callback: (data: RemoteMouseData) => void) => ipcRenderer.on('on-mouse-down', (_event, data) => callback(data)),
  onMouseMove: (callback: (data: RemoteMouseData) => void) => ipcRenderer.on('on-mouse-move', (_event, data) => callback(data)),
  onMouseUp: (callback: (data: RemoteMouseData) => void) => ipcRenderer.on('on-mouse-up', (_event, data) => callback(data)),
  onMouseClick: (callback: (data: RemoteMouseData) => void) => ipcRenderer.on('on-mouse-click', (_event, data) => callback(data)),
  onUpdateOverlayData: (callback: (data: OverlayData) => void) => ipcRenderer.on('on-update-overlay-data', (_event, data) => callback(data)),
})

console.log('Preload script has been loaded');
