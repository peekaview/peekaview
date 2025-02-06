import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

import { DialogOptions, RemoteData, RemoteEvent } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  dialog: (options: DialogOptions) => ipcRenderer.invoke('dialog', options),
  sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => ipcRenderer.invoke('on-remote', event, data),
  onRemote: (callback: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void) => ipcRenderer.on('send-remote', (_event, event, data) => callback(event, data)),
  onReplyDialog: (callback: (dialogId: number, result: string) => void) => ipcRenderer.on('reply-dialog', (_event, dialogId: number, result: string) => callback(dialogId, result)),
  logout: (discardSession = false) => ipcRenderer.invoke('logout', discardSession),
  sharingActive: (viewCode: string, data: string) => ipcRenderer.invoke('sharing-active', viewCode, data),
  stopSharing: () => ipcRenderer.invoke('stop-sharing'),
  pauseSharing: () => ipcRenderer.invoke('pause-sharing'),
  resumeSharing: () => ipcRenderer.invoke('resume-sharing'),
  updateUsers: (users: string) => ipcRenderer.invoke('update-users', users),
  onOpenScreenSourceSelection: (callback: () => void) => ipcRenderer.on('open-screen-source-selection', () => callback()),
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  sourceSelected: (source: string | undefined) => ipcRenderer.invoke('source-selected', source),
});

console.log('Preload script has been loaded');
