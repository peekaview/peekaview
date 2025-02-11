<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Sources from './Sources.vue'

import { usePresenter, getStreamFromSource, Presenter } from '../../composables/usePresenter'
import { ScreenSource } from '../../../interface'

const { t } = useI18n()

const showSources = ref(false)
const selectedSource = ref<ScreenSource>()

const presenter = ref<Presenter>()

onMounted(() => start())

onBeforeUnmount(() => {
  presenter.value?.cleanUpStream()
  presenter.value?.cleanUpCallbacks()
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

async function start() {
  let params = new URLSearchParams(window.location.search)
  const data = params.get('data')
  if (!data)
    throw new Error('')

  params = new URLSearchParams(atob(data))
  const email = params.get('email')!
  const token = params.get('token')!
  presenter.value = usePresenter(email, token, t, async (shareAudio) => {
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

    window.electronAPI?.sharingActive(presenter.value!.viewCode, JSON.stringify({ source, roomId: presenter.value!.screenShareData!.roomId, userName: email }))
    return getStreamFromSource(source, shareAudio)
  })
  presenter.value.startSession()
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
  <Sources
    v-if="showSources"
    @select="select"
    @cancel="close"
  />
</template>

<style>
</style>
