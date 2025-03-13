import { initializeApp } from "firebase/app"
import { getMessaging, getToken } from "firebase/messaging"

import firebaseConfig from '../firebase.json'

const app = initializeApp(firebaseConfig)

export const messaging = getMessaging(app)

export async function getPushToken() {
  return getToken(messaging, {
    vapidKey: firebaseConfig.vapidKey,
  })
}