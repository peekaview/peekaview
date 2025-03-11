<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Sources from './Sources.vue'

import { usePresenter, getStreamFromSource, Presenter } from '../../composables/usePresenter'
import { ScreenSource } from '../../../interface'
import { getUuid, notify, prompt } from '../../util'
import { callApi, UnauthorizedError } from '../../api'

const { t } = useI18n()

const showSources = ref(false)
const selectedSource = ref<ScreenSource>()

const pointerEnabled = ref(false)
const remoteControlEnabled = ref(false)

const presenter = ref<Presenter>()
const unauthorized = ref(false)

onMounted(() => present())

onBeforeUnmount(() => {
  presenter.value?.cleanUpStream()
  presenter.value?.cleanUpCallbacks()
})

window.electronAPI?.onFirebaseStarted((token) => {
  updatePushToken(token)
})

window.electronAPI?.onFirebaseError((error) => {
  console.error('Firebase error:', error)
  window.electronAPI?.log('Firebase error:', error)
})

window.electronAPI?.onFirebaseTokenUpdated((token) => {
  updatePushToken(token)
})

window.electronAPI?.onFirebaseNotificationReceived((notification) => {
  console.log('Firebase notification received:', notification)
})

window.electronAPI?.onOpenScreenSourceSelection(() => {
  presenter.value?.presentSource()
})

window.electronAPI?.onPauseSharing(() => {
  presenter.value?.pauseSharing()
})

window.electronAPI?.onResumeSharing(() => {
  presenter.value?.resumeSharing()
})

window.electronAPI?.onTogglePointer((toggle) => {
  if (toggle === undefined)
    pointerEnabled.value = !pointerEnabled.value
  else
    pointerEnabled.value = toggle
})

window.electronAPI?.onToggleRemoteControl((toggle) => {
  if (toggle === undefined)
    remoteControlEnabled.value = !remoteControlEnabled.value  
  else
    remoteControlEnabled.value = toggle
})

async function present() {
  let params = new URLSearchParams(window.location.search)
  const data = params.get('data')
  if (!data)
    throw new Error('')

  params = new URLSearchParams(atob(data))
  const email = params.get('email')!
  const token = params.get('token')!
  presenter.value = usePresenter({
    email,
    token,
    pointerEnabled,
    remoteControlEnabled,
  }, async (shareAudio) => {
    showSources.value = true
    const source = await new Promise<ScreenSource | undefined>((resolve) => {
      watch<[ScreenSource | undefined, boolean]>(() => [selectedSource.value, showSources.value], ([source, show]) => {
        resolve(show ? source : undefined)
      }, { once: true })
    })

    showSources.value = false
    selectedSource.value = undefined
    if (!source)
      return

    window.electronAPI?.sharingActive(presenter.value!.viewCode, JSON.stringify({ source, userName: email }))
    return getStreamFromSource(source, shareAudio)
  }, {
    onRequest: async (request) => {
      const result = await prompt({
        text: t('share.requestAccess.message', { name: request.name }),
        confirmButtonText: t('share.requestAccess.accept'),
        cancelButtonText: t('share.requestAccess.deny'),
        sound: 'ringtone',
      })
          
      return (result === '0')
    },
    onApiError: (error) => {
      if (error instanceof UnauthorizedError) {
        unauthorized.value = true
        return
      }

      notify({
        type: 'error',
        title: t('general.error'),
        text: t('share.requestError') + '\n\n' + error.message,
        confirmButtonText: t('general.ok'),
      })
    }
  })
  presenter.value.startSession()
}

async function updatePushToken(token: string) {
  console.log('updatePushToken', token)
  const uuid = await getUuid()
  callApi({
    action: 'registerPushToken',
    uuid,
    token,
  })
}

function select(source: ScreenSource) {
  selectedSource.value = source
  window.electronAPI?.sourceSelected(JSON.stringify(source))
}

function close() {
  window.electronAPI?.sourceSelected(undefined)
}
</script>

<template>
  <div v-if="unauthorized" class="text-center text-danger">
    <h2>{{ $t('sourcesWindow.unauthorized') }}</h2>
  </div>
  <Sources
    v-else-if="showSources"
    @select="select"
    @cancel="close"
  />
</template>

<style>
html {
  background: transparent !important;
}

body {
  padding: 5px;
  overflow: hidden;
  background: transparent !important;
}

#presenter {
  height: 100%;
  color: #ddd;
  background-color: #282828;
  border-radius: 15px;
}
</style>
