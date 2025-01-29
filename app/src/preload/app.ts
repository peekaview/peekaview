import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

import { DialogOptions, RemoteData, RemoteEvent, ScreenSource, StreamerData } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  dialog: (options: DialogOptions) => ipcRenderer.invoke('dialog', options),
  sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => ipcRenderer.invoke('on-remote', event, data),
  onRemote: (callback: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void) => ipcRenderer.on('send-remote', (_event, event, data) => callback(event, data)),
  onReplyDialog: (callback: (dialogId: number, result: string) => void) => ipcRenderer.on('reply-dialog', (_event, dialogId: number, result: string) => callback(dialogId, result)),
  onSendScreenSource: (callback: (source: ScreenSource | undefined) => void) => ipcRenderer.on('send-screen-source', (_event, source) => callback(source)),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  logout: (discardSession = false) => ipcRenderer.invoke('logout', discardSession),
  startRemoteControl: (data: StreamerData) => ipcRenderer.invoke('start-remote-control', data),
  sharingActive: (viewCode: string, data: string) => ipcRenderer.invoke('sharing-active', viewCode, data),
  handleAppClosing: () => ipcRenderer.invoke('handle-app-closing'),
  stopSharing: () => ipcRenderer.invoke('stop-sharing'),
  pauseSharing: () => ipcRenderer.invoke('pause-sharing'),
  resumeSharing: () => ipcRenderer.invoke('resume-sharing'),
  updateUsers: (users: string) => ipcRenderer.invoke('update-users', users),
  onCleanUpStream: (callback: () => void) => ipcRenderer.on('clean-up-stream', () => callback()),
});

console.log('Preload script has been loaded');
