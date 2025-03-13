import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'
import { ElectronWindowDimensions, OverlayData } from '../interface';

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  toggleClipboard: (toggle?: boolean) => ipcRenderer.invoke('toggle-clipboard', toggle),
  onUpdateOverlayData: (callback: (data: OverlayData) => void) => ipcRenderer.on('on-update-overlay-data', (_event, data) => callback(data)),
  onToggleRemoteControl: (callback: (toggle?: boolean) => void) => ipcRenderer.on('on-toggle-remote-control', (_event, toggle?: boolean) => callback(toggle)),
  onTogglePointer: (callback: (toggle?: boolean) => void) => ipcRenderer.on('on-toggle-pointer', (_event, toggle?: boolean) => callback(toggle)),
  setToolbarSize: (width: number, height: number) => ipcRenderer.invoke('set-toolbar-size', width, height),
  stopSharing: () => ipcRenderer.invoke('stop-sharing'),
  pauseSharing: () => ipcRenderer.invoke('pause-sharing'),
  resumeSharing: () => ipcRenderer.invoke('resume-sharing'),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  showSharingActive: () => ipcRenderer.invoke('show-sharing-active'),
  resizeWindow: (windowName: string, dimensions: ElectronWindowDimensions) => ipcRenderer.invoke('resize-window', windowName, dimensions),
})
