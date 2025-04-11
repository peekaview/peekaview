import { ipcRenderer } from 'electron'
import { StorageSchema } from '../store'

export const base = {
  log: (...messages: any[]) => ipcRenderer.invoke('log', messages),
  getStoredItem: <K extends keyof StorageSchema>(key: K, defaultValue?: StorageSchema[K]) => ipcRenderer.invoke('get-stored-item', key, defaultValue),
  setStoredItem: <K extends keyof StorageSchema>(key: K, value: StorageSchema[K]) => ipcRenderer.invoke('set-stored-item', key, value),
  removeStoredItem: <K extends keyof StorageSchema>(key: K) => ipcRenderer.invoke('remove-stored-item', key),
  onChangeLanguage: (callback: (locale: string) => void) => ipcRenderer.on('change-language', (_event, locale: string) => callback(locale)),
  getResourcesPath: () => ipcRenderer.invoke('get-resources-path'),
  openAllDevTools: () => ipcRenderer.invoke('open-all-dev-tools'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
}
