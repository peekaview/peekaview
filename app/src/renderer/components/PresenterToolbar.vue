<script setup lang="ts">
import { ref, nextTick, useTemplateRef, watch } from 'vue'
import Toolbar from '../components/Toolbar.vue'

import ClipboardTextOutlineSvg from '../../assets/icons/clipboard-text-outline.svg'

const emit = defineEmits<{
  (e: 'toggle-remote-control', enabled: boolean): void
  (e: 'toggle-mouse', enabled: boolean): void
  (e: 'toggle-clipboard'): void
  (e: 'pause-sharing'): void
  (e: 'resume-sharing'): void
  (e: 'stop-sharing'): void
  (e: 'share-different-screen'): void
  (e: 'show-sharing-active'): void
}>()

const inBrowser = ref(!window.electronAPI)
const remoteControlEnabled = ref(true)
const mouseEnabled = ref(true)
const isPaused = ref(false)
const toolbarRef = useTemplateRef('toolbar')

watch(remoteControlEnabled, (enabled) => emit('toggle-remote-control', enabled))
watch(mouseEnabled, (enabled) => emit('toggle-mouse', enabled))
watch(isPaused, (enabled) => enabled ? emit('pause-sharing') : emit('resume-sharing'))

function stopSharing() {
  window.electronAPI!.stopSharing()
  emit('stop-sharing')
}

function shareDifferentScreen() {
  window.electronAPI!.openScreenSourceSelection()
  emit('share-different-screen')
}

function toggleClipboard() {
  window.electronAPI!.toggleClipboard()
  emit('toggle-clipboard')
}

function showSharingActive() {
  window.electronAPI!.showSharingActive()
  emit('show-sharing-active')
}

function onCollapse() {
  if (inBrowser.value)
    return

  nextTick(() => {
    const rect = toolbarRef.value?.$el.getBoundingClientRect()
    if (!rect)
      return

    window.electronAPI!.resizeWindow('toolbar', {
      size: {
        width: Math.round(rect.width),
      },
      minimumSize: {
        width: Math.round(rect.width),
      },
    })
  })
}
</script>

<template>
  <Toolbar ref="toolbar" class="main-toolbar" :collapsible="!inBrowser" draggable poll-size @on-collapse="onCollapse">
    <label class="checkbox-container">
      <input type="checkbox" v-model="remoteControlEnabled" />
      <span class="checkmark"></span>
      <span class="checkbox-label">Remote Control</span>
    </label>
    <label class="checkbox-container">
      <input v-if="remoteControlEnabled" type="checkbox" checked disabled />
      <input v-else type="checkbox" v-model="mouseEnabled" />
      <span class="checkmark"></span>
      <span class="checkbox-label">Pointer</span>
    </label>
    <div class="btn btn-sm btn-secondary" title="Toggle clipboard" style="width: 30px" @click="toggleClipboard">
      <ClipboardTextOutlineSvg />
    </div>
    <div v-if="!inBrowser" class="btn btn-sm btn-secondary" title="Share different screen" style="width: 30px" @click="shareDifferentScreen">
      <svg width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path fill="#666" d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h3l-1 1v2h12v-2l-1-1h3c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
      </svg>
    </div>
    <div v-if="!inBrowser" class="btn btn-sm btn-secondary" title="Show invite link" style="width: 30px" @click="showSharingActive">
      <svg width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path fill="#666" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
      </svg>
    </div>
    <div class="btn btn-sm btn-secondary" title="Pause / Resume" style="width: 30px" @click="isPaused = !isPaused">
      <!-- Pause SVG -->
      <svg v-if="!isPaused" width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path fill="#666" d="M6 4h4v16H6zm8 0h4v16h-4z"/>
      </svg>
      <!-- Play SVG (hidden by default) -->
      <svg v-else width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path fill="#666" d="M8 5v14l11-7z"/>
      </svg>
    </div>
    <div class="btn btn-sm btn-secondary" title="Stop" style="width: 30px" @click="stopSharing">
      <svg width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path fill="#666" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    </div>
  </Toolbar>
</template>

<style>
  #toolbar {
    display: inline-block;
  }
</style>