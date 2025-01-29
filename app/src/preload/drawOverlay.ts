import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'
import { RemoteMouseData, UserData } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  onUpdateUsers: (callback: (users: UserData[]) => void) => ipcRenderer.on('on-update-users', (_event, users) => callback(users)),
  onMouseDown: (callback: (data: RemoteMouseData) => void) => ipcRenderer.on('on-mouse-down', (_event, data) => callback(data)),
  onMouseMove: (callback: (data: RemoteMouseData) => void) => ipcRenderer.on('on-mouse-move', (_event, data) => callback(data)),
  onMouseUp: (callback: (data: RemoteMouseData) => void) => ipcRenderer.on('on-mouse-up', (_event, data) => callback(data)),
  onUpdateScale: (callback: (scale: number) => void) => ipcRenderer.on('on-update-scale', (_event, scale) => callback(scale)),
})

console.log('Preload script has been loaded');
