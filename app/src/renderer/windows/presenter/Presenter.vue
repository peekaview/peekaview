<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Sources from './Sources.vue'

import { usePresenter, getStreamFromSource, Presenter } from '../../composables/usePresenter'
import { ContactData, ScreenSource, ViewerTool } from '../../../interface'
import { notify, prompt } from '../../util'
import { parseCode } from '../../../util'
import { UnauthorizedError } from '../../api'

const { t } = useI18n()

const showSources = ref(false)
const selectedSource = ref<ScreenSource>()

const toolsEnabled = ref<Record<ViewerTool, boolean>>({
  pointer: false,
  remoteControl: false,
})

const presenter = ref<Presenter>()
const contactToNotify = ref<ContactData>()
const unauthorized = ref(false)

onMounted(() => {
  const code = new URLSearchParams(window.location.search).get('data')
  if (!code)
    throw new Error('')

  const { email, token } = parseCode(code)

  present(email!, token!)
})

onBeforeUnmount(() => {
  presenter.value?.cleanUpStream()
  presenter.value?.cleanUpCallbacks()
})

window.electronAPI?.onNotifyContact((contact) => {
  contactToNotify.value = contact
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
    toolsEnabled.value.pointer = !toolsEnabled.value.pointer
  else
    toolsEnabled.value.pointer = toggle
})

window.electronAPI?.onToggleRemoteControl((toggle) => {
  if (toggle === undefined)
    toolsEnabled.value.remoteControl = !toolsEnabled.value.remoteControl
  else
    toolsEnabled.value.remoteControl = toggle
})

async function present(email: string, token: string) {
  presenter.value = usePresenter({
    email,
    token,
    toolsEnabled,
  }, async (shareAudio) => {
    showSources.value = true
    const source = await new Promise<ScreenSource | undefined>((resolve) => {
      watch<[ScreenSource | undefined, boolean]>(() => [selectedSource.value, showSources.value], ([source, show]) => {
        resolve(show ? source : undefined)
      }, { once: true })
    })

    showSources.value = false
    selectedSource.value = undefined

    const stream = source ? await getStreamFromSource(source, shareAudio) : undefined
    return { stream, source }
  }, {
    notify: {
      contact: contactToNotify,
      getMessage: (name: string) => t('notifications.viewSharedScreen', { name }),
    },
    onRequest: async (_id, name) => {
      const result = await prompt({
        type: 'info',
        text: t('share.requestAccess', { name }),
        confirmButtonText: t('general.accept'),
        cancelButtonText: t('general.deny'),
        sound: 'ringtone',
      })
          
      return (result === '0')
    },
    onAllViewersLeft: async () => {
      const result = await prompt({
        type: 'info',
        text: t('share.allViewersLeft'),
        confirmButtonText: t('general.yes'),
        cancelButtonText: t('general.no'),
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

  await presenter.value.startSession()
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
