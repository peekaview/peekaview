import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  toggleRemoteControl: (toggle?: boolean) => ipcRenderer.invoke('toggle-remote-control', toggle),
  toggleMouse: (toggle?: boolean) => ipcRenderer.invoke('toggle-mouse', toggle),
  toggleClipboard: (toggle?: boolean) => ipcRenderer.invoke('toggle-clipboard', toggle),
  setToolbarSize: (width: number, height: number) => ipcRenderer.invoke('set-toolbar-size', width, height),
  stopSharing: () => ipcRenderer.invoke('stop-sharing'),
  pauseSharing: () => ipcRenderer.invoke('pause-sharing'),
  resumeSharing: () => ipcRenderer.invoke('resume-sharing'),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  showSharingActive: () => ipcRenderer.invoke('show-sharing-active'),
})

console.log('Preload script has been loaded');
