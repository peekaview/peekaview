import { ipcRenderer } from 'electron'
import {
  START_NOTIFICATION_SERVICE,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
} from 'firebase-electron/dist/electron/consts'

import firebaseConfig from '../firebase.json'

export const firebase = {
  onFirebaseStarted: (callback: (token: string) => void) => ipcRenderer.on(NOTIFICATION_SERVICE_STARTED, (_event, token) => callback(token)),
  onFirebaseError: (callback: (error: string) => void) => ipcRenderer.on(NOTIFICATION_SERVICE_ERROR, (_event, error) => callback(error)),
  onFirebaseTokenUpdated: (callback: (token: string) => void) => ipcRenderer.on(TOKEN_UPDATED, (_event, token) => callback(token)),
  onFirebaseNotificationReceived: (callback: (notification: any) => void) => ipcRenderer.on(NOTIFICATION_RECEIVED, (_event, notification) => callback(notification)),
}

ipcRenderer.send(START_NOTIFICATION_SERVICE, {
  appId: firebaseConfig.appId,
  apiKey: firebaseConfig.apiKey,
  projectId: firebaseConfig.projectId,
  vapidKey: firebaseConfig.vapidKey
})