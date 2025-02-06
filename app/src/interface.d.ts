import { PanzoomEvent } from '@panzoom/panzoom';
import { type DialogOptions } from './main/composables/useCustomDialog'

declare global {
  interface Window {
    electronAPI?: IElectronAPI
    presenterControl?: {
      stopSharing: () => void
    }
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
  openScreenSourceSelection: () => Promise<void>,
  onOpenScreenSourceSelection: (callback: () => void) => void,
  sourceSelected: (source: string | undefined) => Promise<void>,
  sharingActive: (viewCode: string, data: string) => Promise<void>,
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
  closeWindow: () => Promise<void>,
  onMouseDown: (callback: (data: RemoteMouseData) => void) => void,
  onMouseMove: (callback: (data: RemoteMouseData) => void) => void,
  onMouseUp: (callback: (data: RemoteMouseData) => void) => void,
  onMouseClick: (callback: (data: RemoteMouseData) => void) => void,
  onUpdateOverlayData: (callback: (data: OverlayData) => void) => void,
  updateUsers: (users: string) => Promise<void>,
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

export type UserData = {
  id: string
  name: string
  color: string
}

export type PeerData = {
  type: 'identity'
  user: UserData
} | {
  type: 'remote'
  event: RemoteEvent
  data: RemoteData<RemoteEvent>
} | {
  type: 'leave'
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

export type RemoteEvent = "browser" | "text" | "mouse-click" | "mouse-dblclick" | "mouse-leftclick" | "mouse-move" | "mouse-down" | "mouse-up" | "mouse-wheel" | "toggle-freeze" | "type" | "copy" | "paste" | "cut" | "file" | "file-chunk" | "reset" | "mouse-control" | "remote-control"

export type RemoteData<T extends RemoteEvent> = 
  T extends "browser" ? { }
  : T extends "text" ? { text: string }
  : T extends "mouse-click" ? RemoteMouseData
  : T extends "mouse-dblclick" ? RemoteMouseData
  : T extends "mouse-leftclick" ? RemoteMouseData
  : T extends "mouse-move" ? RemoteMouseData
  : T extends "mouse-down" ? RemoteMouseData
  : T extends "mouse-up" ? RemoteMouseData
  : T extends "mouse-wheel" ? RemoteMouseData
  : T extends "toggle-freeze" ? { enabled: boolean }
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
    userId: string
    x: number
    y: number
    delta?: number
    draw?: boolean
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
    isScreen: boolean
    dimensions: Dimensions
    coverBounds: Rectangle[]
  }

  export type OverlayData = {
    users?: UserData[]
    scale?: number
    mouseEnabled?: boolean
    remoteControlActive?: boolean
  }

  export type Dimensions = {
    left: number
    top: number
    right: number
    bottom: number
  }

  export type Rectangle = {
    x: number
    y: number
    width: number
    height: number
  }

  export type Point = {
    x: number
    y: number
  }

  export type File = {
    content: string
    name?: string
  }

  export type Size = { width: number, height: number }

  export type ElectronWindowDimensions = { size: Partial<Size>, minimumSize?: Partial<Size>, maximumSize?: Partial<Size> }
