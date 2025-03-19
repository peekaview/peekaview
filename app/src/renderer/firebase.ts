import { initializeApp } from "firebase/app"
import { getMessaging, getToken, MessagePayload, onMessage } from "firebase/messaging"

import firebaseConfig from '../../firebase.json'

const app = initializeApp(firebaseConfig)

export const messaging = getMessaging(app)

export async function onNotification(handler: (payload: MessagePayload) => void) {
  onMessage(messaging, handler)
}

export async function getPushToken() {
  return new Promise<string>((resolve, reject) => {
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
        )
        .then(resolve)
        .catch(reject)
    } else {
      reject(new Error('Service worker not supported'))
    }
  })
}