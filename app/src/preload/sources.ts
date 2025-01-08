import { contextBridge, ipcRenderer } from 'electron'

import { base } from './base'

import { ScreenSource } from '../interface'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  selectScreenSource: (source: ScreenSource) => ipcRenderer.invoke('select-screen-source', source),
});

console.log('Preload script has been loaded');
