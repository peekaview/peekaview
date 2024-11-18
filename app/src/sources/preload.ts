import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  selectScreenSourceId: (id: string) => ipcRenderer.invoke('select-screen-source-id', id),
});

console.log('Preload script has been loaded');
