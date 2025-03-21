import { contextBridge, ipcRenderer } from 'electron'

import {
  START_NOTIFICATION_SERVICE,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
} from 'firebase-electron/dist/electron/consts'

import { base } from './base'

import firebaseConfig from '../../firebase.json'
import { NotificationPayload } from '../interface'
import { MessagePayload } from 'firebase/messaging'

contextBridge.exposeInMainWorld('electronAPI', {
  ...base,
  onFirebaseStarted: (callback: (token: string) => void) => ipcRenderer.on(NOTIFICATION_SERVICE_STARTED, (_event, token) => callback(token)),
  onFirebaseError: (callback: (error: string) => void) => ipcRenderer.on(NOTIFICATION_SERVICE_ERROR, (_event, error) => callback(error)),
  onFirebaseTokenUpdated: (callback: (token: string) => void) => ipcRenderer.on(TOKEN_UPDATED, (_event, token) => callback(token)),
  onFirebaseNotificationReceived: (callback: (message: MessagePayload) => void) => ipcRenderer.on(NOTIFICATION_RECEIVED, (_event, message) => callback(message)),
  receiveNotification: (notification: NotificationPayload) => ipcRenderer.invoke('receive-notification', notification),
})

ipcRenderer.send(START_NOTIFICATION_SERVICE, {
  appId: firebaseConfig.appId,
  apiKey: firebaseConfig.apiKey,
  projectId: firebaseConfig.projectId,
  vapidKey: firebaseConfig.vapidKey
})