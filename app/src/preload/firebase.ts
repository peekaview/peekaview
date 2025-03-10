import { ipcRenderer } from 'electron';
import {
  START_NOTIFICATION_SERVICE,
  NOTIFICATION_SERVICE_STARTED,
  NOTIFICATION_SERVICE_ERROR,
  NOTIFICATION_RECEIVED,
  TOKEN_UPDATED,
} from 'firebase-electron/dist/electron/consts';

const firebaseConfig = {
  apiKey: "AIzaSyA1kh7B1ZjH9IDCMEGT83sYgoDY2n3fwTE",
  authDomain: "peekaview-a05e4.firebaseapp.com",
  projectId: "peekaview-a05e4",
  storageBucket: "peekaview-a05e4.firebasestorage.app",
  messagingSenderId: "61688649636",
  appId: "1:61688649636:web:406e089fadbd7f879bd331",
  vapidKey: 'BJ-49jj90QppmMhE76WgyJctFvJO-TP_tya5zPKvmC1bcMG-00WtegYgUyQx66mPFQ6nwUOFA0Ok9gbfKeEbFr4'
}

// Listen for service successfully started
ipcRenderer.on(NOTIFICATION_SERVICE_STARTED, (_, token) => {
  console.log('Notification service started, token:', token);
});

// Handle notification errors
ipcRenderer.on(NOTIFICATION_SERVICE_ERROR, (_, error) => {
  console.error('Notification service error:', error);
});

// Send FCM token to backend
ipcRenderer.on(TOKEN_UPDATED, (_, token) => {
  console.log('FCM token updated:', token);
});

// Display notification
ipcRenderer.on(NOTIFICATION_RECEIVED, (_, notification) => {
  console.log('Notification received:', notification);
});

// Start service
ipcRenderer.send(START_NOTIFICATION_SERVICE, {
  appId: firebaseConfig.appId,
  apiKey: firebaseConfig.apiKey,
  projectId: firebaseConfig.projectId,
  vapidKey: firebaseConfig.vapidKey
});

