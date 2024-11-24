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
  selectScreenSource: (source: ScreenSource | undefined) => Promise<void>,
  onSendScreenSource: (callback: (source: ScreenSource) => void) => Electron.IpcRenderer,
  startRemoteControl: (source: ScreenSource) => Promise<void>,
  createJwtToken: (identity: string | null, roomName?: string) => Promise<string>,
  openScreenSourceSelection: () => Promise<void>,
  handleAppClosing: () => Promise<void>,
}

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}
