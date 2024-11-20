declare global {
  interface Window {
    electronAPI?: IElectronAPI
  }

  interface MediaTrackConstraints {
    mandatory: any
  }
}

declare const APP_URL: string

export interface IElectronAPI {
  log: (...messages: any[]) => Promise<void>,
  logout: (discardSession?: boolean) => Promise<void>,
  loginViaBrowser: (discardSession?: boolean) => Promise<void>,
  loginWithCode: (code: string) => Promise<void>,
  getScreenSources: () => Promise<ScreenSource[]>,
  selectScreenSourceId: (id: string, name: string) => Promise<void>,
  onSendScreenSourceId: (callback: (id: string, name: string) => void) => Electron.IpcRenderer,
  createJwtToken: (identity: string | null, roomName?: string) => Promise<string>,
  openScreenSourceSelection: () => Promise<void>,
  handleAppClosing: () => Promise<boolean>,
  startRemoteControl: (hwnd: string, name: string) => Promise<void>,
}

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}
