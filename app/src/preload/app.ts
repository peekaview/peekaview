import { contextBridge, ipcRenderer } from 'electron'

import { type DialogOptions } from '../main/composables/useCustomDialog'
import { base } from './base'

import { ScreenSource } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  dialog: (options: DialogOptions) => ipcRenderer.invoke('dialog', options),
  onReplyDialog: (callback: (dialogId: number, result: string) => void) => ipcRenderer.on('on-reply-dialog', (_event, dialogId: number, result: string) => callback(dialogId, result)),
  onSendScreenSource: (callback: (source: ScreenSource) => void) => ipcRenderer.on('send-screen-source', (_event, source: ScreenSource) => callback(source)),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  logout: (discardSession = false) => ipcRenderer.invoke('logout', discardSession),
  startRemoteControl: (source: ScreenSource, roomName: string, roomId: string, userName: string, userId: string) => ipcRenderer.invoke('start-remote-control', source, roomName, roomId, userName, userId),
  sharingActive: (viewCode: string, source: ScreenSource, roomName: string, roomId: string, userName: string, userId: string) => ipcRenderer.invoke('sharing-active', viewCode, source, roomName, roomId, userName, userId),
  handleAppClosing: () => ipcRenderer.invoke('handle-app-closing'),
});

console.log('Preload script has been loaded');
