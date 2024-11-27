import { contextBridge, ipcRenderer } from 'electron'

import { type DialogParams } from '../main/composables/useCustomDialog'
import { base } from './base'

import { ScreenSource } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  dialog: (params: DialogParams) => ipcRenderer.invoke('dialog', params),
  onReplyDialog: (callback: (dialogId: number, result: string) => void) => ipcRenderer.on('on-reply-dialog', (_event, dialogId: number, result: string) => callback(dialogId, result)),
  onSendScreenSource: (callback: (source: ScreenSource) => void) => ipcRenderer.on('send-screen-source', (_event, source: ScreenSource) => callback(source)),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  logout: (discardSession = false) => ipcRenderer.invoke('logout', discardSession),
  handleAppClosing: () => ipcRenderer.invoke('handle-app-closing'),
  startRemoteControl: (source: ScreenSource) => ipcRenderer.invoke('start-remote-control', source),
});

console.log('Preload script has been loaded');
