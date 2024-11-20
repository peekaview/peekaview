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
  onChangeLanguage: (callback: (locale: string) => void) => Electron.IpcRenderer,
  logout: (discardSession?: boolean) => Promise<void>,
  loginViaBrowser: (discardSession?: boolean) => Promise<void>,
  loginWithCode: (code: string) => Promise<void>,
  getScreenSources: () => Promise<ScreenSource[]>,
  selectScreenSourceId: (id: string, name: string) => Promise<void>,
  onSendScreenSourceId: (callback: (id: string, name: string) => void) => Electron.IpcRenderer,
  startRemoteControl: (sourceId: string, name: string) => Promise<void>,
  createJwtToken: (identity: string | null, roomName?: string) => Promise<string>,
  openScreenSourceSelection: () => Promise<void>,
  handleAppClosing: () => Promise<void>,
}

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}
