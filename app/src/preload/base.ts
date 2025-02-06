import { ipcRenderer } from 'electron'

export const base = {
  log: (...messages: any[]) => ipcRenderer.invoke('log', messages),
  onChangeLanguage: (callback: (locale: string) => void) => ipcRenderer.on('change-language', (_event, locale: string) => callback(locale)),
  closeWindow: () => ipcRenderer.invoke('close-window'),
}