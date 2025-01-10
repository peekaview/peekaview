import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'
import { DialogOptions } from '../interface';

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  onDialog: (callback: (options: DialogOptions) => void) => ipcRenderer.on('dialog', (_event, options) => callback(options)),
  replyDialog: (dialogId: number, result: string) => ipcRenderer.invoke('reply-dialog', dialogId, result),
})

console.log('Preload script has been loaded');
