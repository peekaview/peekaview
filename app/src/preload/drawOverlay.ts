import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'
import { RemoteMouseData, UserData } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  onUpdateUsers: (callback: (users: UserData[]) => void) => ipcRenderer.on('on-update-users', (_event, users) => callback(users)),
  onMouseDown: (callback: (data: RemoteMouseData) => void) => ipcRenderer.on('on-mouse-down', (_event, data) => callback(data)),
  onMouseMove: (callback: (data: RemoteMouseData) => void) => ipcRenderer.on('on-mouse-move', (_event, data) => callback(data)),
  onMouseUp: (callback: (data: RemoteMouseData) => void) => ipcRenderer.on('on-mouse-up', (_event, data) => callback(data)),
})

console.log('Preload script has been loaded');
