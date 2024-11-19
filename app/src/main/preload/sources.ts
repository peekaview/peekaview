import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  selectScreenSourceId: (id: string) => ipcRenderer.invoke('select-screen-source-id', id),
});

console.log('Preload script has been loaded');
