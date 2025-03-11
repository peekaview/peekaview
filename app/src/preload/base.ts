import { ipcRenderer } from 'electron'

export const base = {
  log: (...messages: any[]) => ipcRenderer.invoke('log', messages),
  getUuid: () => ipcRenderer.invoke('get-uuid'),
  getPushToken: () => ipcRenderer.invoke('get-push-token'),
  setPushToken: (token: string) => ipcRenderer.invoke('set-push-token', token),
  onChangeLanguage: (callback: (locale: string) => void) => ipcRenderer.on('change-language', (_event, locale: string) => callback(locale)),
  getResourcesPath: () => ipcRenderer.invoke('get-resources-path'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
}