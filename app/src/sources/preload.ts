const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  selectScreenSourceId: (id: string, name: string) => ipcRenderer.invoke('select-screen-source-id', id, name),
});

console.log('Preload script has been loaded');
