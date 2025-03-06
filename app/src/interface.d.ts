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
  sendRemote: SendRemote,
  onDialog: (callback: (options: DialogOptions) => void) => Electron.IpcRenderer,
  onRemote: (callback: SendRemote) => Electron.IpcRenderer,
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
  onToggleRemoteControl: (callback: (toggle?: boolean) => void) => void,
  togglePointer: (toggle?: boolean) => Promise<void>,
  onTogglePointer: (callback: (toggle?: boolean) => void) => void,
  toggleClipboard: (toggle?: boolean) => Promise<void>,
  clipboardReady: () => Promise<void>,
  dataToClipboard: (callback: (data: string) => void) => Electron.IpcRenderer,
  setToolbarSize: (width: number, height: number) => Promise<void>,
  stopSharing: () => Promise<void>,
  pauseSharing: () => Promise<void>,
  resumeSharing: () => Promise<void>,
  onPauseSharing: (callback: () => void) => void,
  onResumeSharing: (callback: () => void) => void,
  showSharingActive: () => Promise<void>,
  onHidden: (callback: (hidden: boolean) => void) => void,
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
  copyText?: string
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

export type Platform = 'mac' | 'win' | 'linux' | 'android' | 'ios' | 'other'

export type UserData = {
  id: string
  name: string
  color: string
  platform: Platform
  inApp: boolean
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
}

export type ViewerTool = 'pointer' | 'remoteControl'

export type SendRemoteOptions = {
  volatile?: boolean
  socketIds?: string[]
}

export type SendRemote = <T extends RemoteEvent>(event: T, data: RemoteData<T>, options?: SendRemoteOptions) => Promise<void> | void

export type RemoteEvent = "mouse-click" | "mouse-dblclick" | "mouse-leftclick" | "mouse-move" | "mouse-down" | "mouse-up" | "mouse-wheel" | "key-down" | "copy" | "paste" | "text" | "file" | "file-chunk" | "reset"

export type RemoteData<T extends RemoteEvent> = 
  T extends "mouse-click" ? RemoteMouseData
  : T extends "mouse-dblclick" ? RemoteMouseData
  : T extends "mouse-leftclick" ? RemoteMouseData
  : T extends "mouse-move" ? RemoteMouseData
  : T extends "mouse-down" ? RemoteMouseData
  : T extends "mouse-up" ? RemoteMouseData
  : T extends "mouse-wheel" ? RemoteMouseData
  : T extends "key-down" ? RemoteKeyData
  : T extends "copy" ? RemoteCopyData
  : T extends "paste" ? RemotePasteData
  : T extends "text" ? RemoteTextData
  : T extends "file" ? RemoteFileData
  : T extends "file-chunk" ? RemoteFileChunkData
  : T extends "reset" ? RemoteResetData
  : never

  export type RemoteMouseData = {
    userId: string
    x: number
    y: number
    delta?: number
    tool?: ViewerTool
  }

  export type RemoteKeyData = {
    key: string
    tool?: ViewerTool
  }

  export type RemoteCopyData = {
    cut?: boolean
    tool?: ViewerTool
  }

  export type RemotePasteData = {
    text: string
    tool?: ViewerTool
  }

  export type RemoteTextData = {
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
    inBrowser: boolean
    dimensions: Dimensions
    coverBounds: Rectangle[]
    pointerEnabled: boolean
    remoteControlEnabled: boolean
    paused: boolean
    hidden: boolean
  }

  export type OverlayData = {
    users?: UserData[]
    scale?: number
    pointerEnabled?: boolean
    remoteControlEnabled?: boolean
  }

  export type Dimensions = {
    left: number
    top: number
    right: number
    bottom: number
  }

  export type Point = {
    x: number
    y: number
  }

  export type Size = {
    width: number
    height: number
  }

  export type Rectangle = Point & Size

  export type File = {
    content: string
    name?: string
  }

  export type ElectronWindowDimensions = { size: Partial<Size>, minimumSize?: Partial<Size>, maximumSize?: Partial<Size> }
