import { initializeApp } from "firebase/app"
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw"

import firebaseConfig from '../../firebase.json'

const app = initializeApp(firebaseConfig)

const messaging = getMessaging(app)
onBackgroundMessage(messaging, async (payload) => {
  console.log('[Firebase] Received background message ', payload)

  const registration = await navigator.serviceWorker.getRegistration()
  registration?.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: payload.notification.image,
    data: {
      url: payload.data.url
    }
  })
});