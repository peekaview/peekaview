const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onSendScreenSourceId: (callback: (id: string) => void) => ipcRenderer.on('send-screen-source-id', (_event, id: string) => callback(id)),
  openScreenSourceSelection: () => ipcRenderer.invoke('open-screen-source-selection'),
  handleAppClosing: () => ipcRenderer.invoke('handle-app-closing'),
});

console.log('Preload script has been loaded');
