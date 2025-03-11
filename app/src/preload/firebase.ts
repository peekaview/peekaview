import { ipcRenderer } from 'electron'
import {
  START_NOTIFICATION_SERVICE,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
} from 'firebase-electron/dist/electron/consts'

import firebaseConfig from '../firebase.json'

// Listen for service successfully started
ipcRenderer.on(NOTIFICATION_SERVICE_STARTED, (_, token) => {
  console.log('Notification service started, token:', token)
  window?.electronAPI?.log('Notification service started, token:', token)
})

// Handle notification errors
ipcRenderer.on(NOTIFICATION_SERVICE_ERROR, (_, error) => {
  console.error('Notification service error:', error)
})

// Send FCM token to backend
ipcRenderer.on(TOKEN_UPDATED, (_, token) => {
  console.log('FCM token updated:', token)
})

// Display notification
ipcRenderer.on(NOTIFICATION_RECEIVED, (_, notification) => {
  console.log('Notification received:', notification)
})

// Start service
ipcRenderer.send(START_NOTIFICATION_SERVICE, {
  appId: firebaseConfig.appId,
  apiKey: firebaseConfig.apiKey,
  projectId: firebaseConfig.projectId,
  vapidKey: firebaseConfig.vapidKey
})

export { firebaseConfig }

