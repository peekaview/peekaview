import { PanzoomEvent } from '@panzoom/panzoom'
import { type DialogOptions } from './main/composables/useCustomDialog'

import { StorageSchema } from './store'

import { MessagePayload } from 'firebase/messaging'

declare global {
  interface Window {
    electronAPI?: IElectronAPI
    presenterControl?: {
      stopSharing: () => void
    }
  }

  type JsonString<T> = string

  interface JSON {
    /**
     * Converts a JavaScript Object Notation (JSON) string into an object.
     * @param text A valid JSON string.
     * @param reviver A function that transforms the results. This function is called for each member of the object.
     * If a member contains nested objects, the nested objects are transformed before the parent object is.
     */
    parse<T>(text: JsonString<T>, reviver?: (this: any, key: string, value: keyof T) => any): T;
    /**
     * Converts a JavaScript value to a JavaScript Object Notation (JSON) string.
     * @param value A JavaScript value, usually an object or array, to be converted.
     * @param replacer A function that transforms the results.
     * @param space Adds indentation, white space, and line break characters to the return-value JSON text to make it easier to read.
     */
    stringify<T>(value: T, replacer?: (this: any, key: string, value: keyof T) => any, space?: string | number): JsonString<T>;
    /**
     * Converts a JavaScript value to a JavaScript Object Notation (JSON) string.
     * @param value A JavaScript value, usually an object or array, to be converted.
     * @param replacer An array of strings and numbers that acts as an approved list for selecting the object properties that will be stringified.
     * @param space Adds indentation, white space, and line break characters to the return-value JSON text to make it easier to read.
     */
    stringify<T>(value: T, replacer?: (number | string)[] | null, space?: string | number): JsonString<T>;
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
  getStoredItem: <K extends keyof StorageSchema>(key: K, defaultValue?: StorageSchema[K]) => Promise<StorageSchema[K] | undefined>,
  setStoredItem: <K extends keyof StorageSchema>(key: K, value: StorageSchema[K]) => Promise<void>,
  removeStoredItem: <K extends keyof StorageSchema>(key: K) => Promise<void>,
  clearStore: () => Promise<void>,
  onFirebaseStarted: (callback: (token: string) => void) => void,
  onFirebaseError: (callback: (error: string) => void) => void,
  onFirebaseTokenUpdated: (callback: (token: string) => void) => void,
  onFirebaseNotificationReceived: (callback: (message: MessagePayload) => void) => void,
  dialog: (options: DialogOptions) => Promise<void>,
  getResourcesPath: () => Promise<string>,
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
  onClipboardEnabled: (callback: () => void) => void,
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
  onNotifyContact: (callback: (contact: ContactData) => void) => void,
  receiveNotification: (notification: NotificationPayload) => void,
}

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}

export type NotificationPayload = {
  title: string
  message: string
  image?: string
  data?: {
    icon?: string
    url?: string
    type?: 'share' | 'view'
    email?: string
  }
}

export type DialogMessage = {
  content: string
  copyText?: string
}

export type DialogType = 'error' | 'warning' | 'info' | 'success' | 'download' | 'call' | 'question'

export interface DialogOptions {
  id?: number
  title?: string
  messages: (string | DialogMessage)[]
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

export type ViewCodeData = {
  viewEmail: string
  accessToken: string
}

export type Platform = 'mac' | 'win' | 'linux' | 'android' | 'ios' | 'other'

export type AtLeastNameOrEmail = {
  name: string
  email?: string
} | {
  name?: string
  email: string
}

export type UserData = {
  id: string
  color: string
  platform: Platform
  inApp: boolean
} & AtLeastNameOrEmail

export type ContactData = {
  id: string
  lastActive: number
} & AtLeastNameOrEmail

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

export type StreamState = 'hidden' | 'paused' | 'active' | 'stopped'

export type SendRemoteOptions = {
  volatile?: boolean
  socketIds?: string[]
}

export type SendRemote = <T extends RemoteEvent>(event: T, data: RemoteData<T>, options?: SendRemoteOptions) => Promise<void> | void

export type RemoteEvent = "mouse-click" | "mouse-dblclick" | "mouse-leftclick" | "mouse-move" | "mouse-down" | "mouse-up" | "mouse-wheel" | "key-down" | "copy" | "text" | "file" | "file-chunk" | "reset"

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
  toolsEnabled: Record<ViewerTool, boolean>
  streamState: StreamState
}

export type OverlayData = {
  users?: UserData[]
  scale?: number
  toolsEnabled: Record<ViewerTool, boolean>
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

export type ElectronWindowDimensions = { size: Partial<Size>, minimumSize?: Partial<Size>, maximumSize?: Partial<Size>, deltaSize?: Partial<Size> }
