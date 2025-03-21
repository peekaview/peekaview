<script setup lang="ts">
import { getStoredItem } from '../../util'
import { callApi } from '../../api'

window.electronAPI?.log("Notifier started")

window.electronAPI?.onFirebaseStarted((token) => {
  updatePushToken(token)
})

window.electronAPI?.onFirebaseError((error) => {
  window.electronAPI?.log('Firebase error:', error)
})

window.electronAPI?.onFirebaseTokenUpdated((token) => {
  updatePushToken(token)
})

window.electronAPI?.onFirebaseNotificationReceived((message) => {
  window.electronAPI?.receiveNotification({
    title: message.notification?.title ?? '',
    message: message.notification?.body ?? '',
    data: message.data
  })
})

async function updatePushToken(token: string) {
  window.electronAPI?.log('Updated push token:', token)
  const uuid = (await getStoredItem('uuid'))!
  callApi({
    action: 'registerPushToken',
    uuid,
    token,
  }).then((response) => {
    window.electronAPI?.log('Push token registered:', response)
  }, (error) => {
    window.electronAPI?.log('Error registering push token:', error)
  })
}
</script>

<template>
</template>

<style>
html, body {
  background-color: transparent !important;
}
</style>
