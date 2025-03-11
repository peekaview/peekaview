import { ipcRenderer } from 'electron'

export const base = {
  log: (...messages: any[]) => ipcRenderer.invoke('log', messages),
  getStoredItem: (key: string) => ipcRenderer.invoke('get-stored-item', key),
  setStoredItem: (key: string, value: string) => ipcRenderer.invoke('set-stored-item', key, value),
  removeStoredItem: (key: string) => ipcRenderer.invoke('remove-stored-item', key),
  onChangeLanguage: (callback: (locale: string) => void) => ipcRenderer.on('change-language', (_event, locale: string) => callback(locale)),
  getResourcesPath: () => ipcRenderer.invoke('get-resources-path'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
}