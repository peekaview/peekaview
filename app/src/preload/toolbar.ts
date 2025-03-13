import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'
import { ElectronWindowDimensions, OverlayData } from '../interface';

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  toggleClipboard: (toggle?: boolean) => ipcRenderer.invoke('toggle-clipboard', toggle),
  toggleRemoteControl: (toggle?: boolean) => ipcRenderer.invoke('toggle-remote-control', toggle),
  togglePointer: (toggle?: boolean) => ipcRenderer.invoke('toggle-pointer', toggle),
  onUpdateOverlayData: (callback: (data: OverlayData) => void) => ipcRenderer.on('on-update-overlay-data', (_event, data) => callback(data)),
  setToolbarSize: (width: number, height: number) => ipcRenderer.invoke('set-toolbar-size', width, height),
  stopSharing: () => ipcRenderer.invoke('stop-sharing'),
  pauseSharing: () => ipcRenderer.invoke('pause-sharing'),
  resumeSharing: () => ipcRenderer.invoke('resume-sharing'),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  showSharingActive: () => ipcRenderer.invoke('show-sharing-active'),
  resizeWindow: (windowName: string, dimensions: ElectronWindowDimensions) => ipcRenderer.invoke('resize-window', windowName, dimensions),
})
