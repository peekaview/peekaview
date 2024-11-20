import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  selectScreenSourceId: (id: string, name: string) => ipcRenderer.invoke('select-screen-source-id', id, name),
});

console.log('Preload script has been loaded');
