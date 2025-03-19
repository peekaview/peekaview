import { initializeApp } from "firebase/app"
import { getMessaging, getToken, onMessage } from "firebase/messaging"

import firebaseConfig from '../../firebase.json'

const app = initializeApp(firebaseConfig)

export const messaging = getMessaging(app)

export async function onNotification() {
  console.log('onNotification')
  onMessage(messaging, (payload) => {
    console.log('Notification received', payload)
  })
}

export async function getPushToken() {
  return new Promise((resolve, reject) => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(    
          import.meta.env.MODE === 'production' ? '/sw.js' : '/dev-sw.js?dev-sw',
          { type: import.meta.env.MODE === 'production' ? 'classic' : 'module' }
        )
        .then((registration) => 
          getToken(messaging, {
            vapidKey: firebaseConfig.vapidKey,
            serviceWorkerRegistration : registration 
          })
        , reject)
        .then(resolve, reject)
    } else {
      reject(new Error('Service worker not supported'))
    }
  })
}