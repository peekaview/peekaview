import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'
import { ContactData } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  onNotifyContact: (callback: (contact: ContactData) => void) => ipcRenderer.on('on-notify-contact', (_event, contact: ContactData) => callback(contact)),
});
