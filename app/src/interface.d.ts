import { PanzoomEvent } from '@panzoom/panzoom';
import { type DialogOptions } from './main/composables/useCustomDialog'

declare global {
  interface Window {
    electronAPI?: IElectronAPI
  }

  interface MediaTrackConstraints {
    mandatory?: any
  }

  interface HTMLElement {
    addEventListener<K extends PanzoomEvent>(type: K, listener: (this: HTMLElement, ev: { detail: PanzoomEventDetail }) => any, options?: boolean | AddEventListenerOptions): void;
  }

  interface HTMLDivElement {
    addEventListener<K extends PanzoomEvent>(type: K, listener: (this: HTMLDivElement, ev: { detail: PanzoomEventDetail }) => any, options?: boolean | AddEventListenerOptions): void;
  }
}

export interface IElectronAPI {
  log: (...messages: any[]) => Promise<void>,
  dialog: (options: DialogOptions) => Promise<void>,
  sendRemote: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => Promise<void>,
  onDialog: (callback: (options: DialogOptions) => void) => Electron.IpcRenderer,
  onRemote: (callback: <T extends RemoteEvent>(event: T, data: RemoteData<T>) => void) => Electron.IpcRenderer,
  onReplyDialog: (callback: (dialogId: number, result: string) => void) => Electron.IpcRenderer,
  onChangeLanguage: (callback: (locale: string) => void) => Electron.IpcRenderer,
  replyDialog: (dialogId: number, result: string) => Promise<void>,
  logout: (discardSession?: boolean) => Promise<void>,
  loginViaBrowser: (discardSession?: boolean) => Promise<void>,
  loginWithCode: (code: string) => Promise<void>,
  getScreenSources: () => Promise<ScreenSource[]>,
  selectScreenSource: (source: ScreenSource | undefined) => Promise<void>,
  onSendScreenSource: (callback: (source: ScreenSource | undefined) => void) => void,
  startRemoteControl: (data: StreamerData) => Promise<void>,
  createJwtToken: (identity: string | null, roomName?: string) => Promise<string>,
  openScreenSourceSelection: () => Promise<void>,
  sharingActive: (viewCode: string, data: string) => Promise<void>,
  handleAppClosing: () => Promise<void>,
  toggleRemoteControl: (toggle?: boolean) => Promise<void>,
  toggleMouse: (toggle?: boolean) => Promise<void>,
  toggleClipboard: (toggle?: boolean) => Promise<void>,
  clipboardReady: () => Promise<void>,
  dataToClipboard: (callback: (data: string) => void) => Electron.IpcRenderer,
  setToolbarSize: (width: number, height: number) => Promise<void>,
  stopSharing: () => Promise<void>,
  pauseSharing: () => Promise<void>,
  resumeSharing: () => Promise<void>,
  showSharingActive: () => Promise<void>,
  resizeWindow: (windowName: string, dimensions: ElectronWindowDimensions) => Promise<void>,
  quit: () => Promise<void>,
  closeClipboard: () => Promise<void>,
  onCleanUpStream: (callback: () => void) => void
}

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}

export type DialogType = 'error' | 'warning' | 'info' | 'success' | 'download' | 'call' | 'question'

export interface DialogOptions {
  id?: number
  title?: string
  message?: string
  detail?: string
  type?: DialogType
  windowType?: 'tray' | 'dialog'
  sound?: string | null
  noLink?: boolean
  buttons?: string[]
  defaultId?: number
  cancelId?: number
  timeout?: number
  data?: any
}

export type PeerData = {
  type: 'identity'
  name: string
} | {
  type: 'remote'
  event: RemoteEvent
  data: RemoteData<RemoteEvent>
} | {
  type: 'leave' | 'close' | 'reset'
}

export type TurnCredentials = {
  urls?: string[]
  username: string
  credential: string
}

export type StreamerData = {
  source: ScreenSource
  roomId: string
}

export type RemoteEvent = "enable" | "getclipboard" | "mouse-click" | "mouse-dblclick" | "mouse-leftclick" | "paint-mouse-leftclick" | "mouse-move" | "paint-mouse-move" | "mouse-down" | "paint-mouse-down" | "mouse-up" | "paint-mouse-up" | "mouse-wheel" | "type" | "copy" | "paste" | "cut" | "file" | "file-chunk" | "reset" | "mouse-control" | "remote-control"

export type RemoteData<T extends RemoteEvent> = 
  T extends "enable" ? { }
  : T extends "getclipboard" ? { text: string }
  : T extends "mouse-click" ? RemoteMouseData
  : T extends "mouse-dblclick" ? RemoteMouseData
  : T extends "mouse-leftclick" ? RemoteMouseData
  : T extends "paint-mouse-leftclick" ? RemoteMouseData
  : T extends "mouse-move" ? RemoteMouseData
  : T extends "paint-mouse-move" ? RemoteMouseData
  : T extends "mouse-down" ? RemoteMouseData
  : T extends "paint-mouse-down" ? RemoteMouseData
  : T extends "mouse-up" ? RemoteMouseData
  : T extends "paint-mouse-up" ? RemoteMouseData
  : T extends "mouse-wheel" ? RemoteMouseData
  : T extends "type" ? { key: string }
  : T extends "copy" ? {}
  : T extends "cut" ? {}
  : T extends "paste" ? RemotePasteData
  : T extends "file" ? RemoteFileData
  : T extends "file-chunk" ? RemoteFileChunkData
  : T extends "reset" ? RemoteResetData
  : T extends "mouse-control" ? { enabled: boolean }
  : T extends "remote-control" ? { enabled: boolean }
  : never

  export type RemoteMouseData = {
    id: string
    color: string // TODO: register name and color by id for each client instead of sending it every time
    name: string
    x: number
    y: number
    delta?: number
  }

  export type RemotePasteData = {
    text: string
    time: number
  }

  export type RemoteFileData = {
    id: string
    name: string
    length: number
  }

  export type RemoteFileChunkData = {
    id: string
    index: number
    content: string
  }

  export type RemoteResetData = {
    room: string
    scalefactor: number
    isScreen: boolean
    remotecontrol: boolean
    mouseenabled: boolean
    dimensions: {
      left: number
      top: number
      right: number
      bottom: number
    }
    toolbarBounds: Rectangle | undefined
  }

  export type Rectangle = {
    x: number
    y: number
    width: number
    height: number
  }

  export type File = {
    content: string
    name?: string
  }

  export type Dimensions = { width: number, height: number }

  export type ElectronWindowDimensions = { size: Partial<Dimensions>, minimumSize?: Partial<Dimensions>, maximumSize?: Partial<Dimensions> }
