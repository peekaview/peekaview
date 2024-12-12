import { type DialogOptions } from './main/composables/useCustomDialog'

declare global {
  interface Window {
    electronAPI?: IElectronAPI
  }

  interface MediaTrackConstraints {
    mandatory?: any
  }
}

export interface IElectronAPI {
  log: (...messages: any[]) => Promise<void>,
  dialog: (options: DialogOptions) => Promise<void>,
  onReplyDialog: (callback: (dialogId: number, result: string) => void) => Electron.IpcRenderer,
  onChangeLanguage: (callback: (locale: string) => void) => Electron.IpcRenderer,
  logout: (discardSession?: boolean) => Promise<void>,
  loginViaBrowser: (discardSession?: boolean) => Promise<void>,
  loginWithCode: (code: string) => Promise<void>,
  getScreenSources: () => Promise<ScreenSource[]>,
  selectScreenSource: (source: ScreenSource | undefined) => Promise<void>,
  onSendScreenSource: (callback: (source: ScreenSource) => void) => Electron.IpcRenderer,
  startRemoteControl: (source: ScreenSource, roomName: string, roomId: string, userName: string, userId: string) => Promise<void>,
  createJwtToken: (identity: string | null, roomName?: string) => Promise<string>,
  openScreenSourceSelection: () => Promise<void>,
  sharingActive: (viewCode: string, source: ScreenSource, roomName: string, roomId: string, userName: string, userId: string) => Promise<void>,
  handleAppClosing: () => Promise<void>,
  stopSharing: () => Promise<void>,
  quit: () => Promise<void>,
}

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}
