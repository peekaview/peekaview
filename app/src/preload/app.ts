import { contextBridge, ipcRenderer } from 'electron'

import { type DialogOptions } from '../main/composables/useCustomDialog'
import { base } from './base'

import { ScreenSource, StreamerData } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  dialog: (options: DialogOptions) => ipcRenderer.invoke('dialog', options),
  onReplyDialog: (callback: (dialogId: number, result: string) => void) => ipcRenderer.on('on-reply-dialog', (_event, dialogId: number, result: string) => callback(dialogId, result)),
  onSendScreenSource: (callback: (source: ScreenSource) => void) => ipcRenderer.on('send-screen-source', (_event, source: ScreenSource) => callback(source)),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  logout: (discardSession = false) => ipcRenderer.invoke('logout', discardSession),
  startRemoteControl: (data: StreamerData) => ipcRenderer.invoke('start-remote-control', data),
  sharingActive: (viewCode: string, data: string) => ipcRenderer.invoke('sharing-active', viewCode, data),
  handleAppClosing: () => ipcRenderer.invoke('handle-app-closing'),
  stopSharing: () => ipcRenderer.invoke('stop-sharing'),
  pauseSharing: () => ipcRenderer.invoke('pause-sharing'),
  resumeSharing: () => ipcRenderer.invoke('resume-sharing'),
});

console.log('Preload script has been loaded');
