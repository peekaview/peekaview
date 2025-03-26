<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'

import PresenterToolbar from '../../components/PresenterToolbar.vue'

import { UserData } from '../../../interface'

const toolbar = useTemplateRef<InstanceType<typeof PresenterToolbar>>('toolbar')

const users = ref<UserData[]>([])

const clipboardEnabled = ref(false)

window.electronAPI?.onClipboardEnabled(() => {
  clipboardEnabled.value = true
})

window.electronAPI?.onUpdateOverlayData((data) => {
  data.users !== undefined && (users.value = data.users)
  data.toolsEnabled !== undefined && toolbar.value?.togglePointer(data.toolsEnabled.pointer)
  data.toolsEnabled !== undefined && toolbar.value?.toggleRemoteControl(data.toolsEnabled.remoteControl)
})

function togglePointer(enabled: boolean) {
  window.electronAPI!.togglePointer(enabled)
}

function toggleRemoteControl(enabled: boolean) {
  window.electronAPI!.toggleRemoteControl(enabled)
}

function pauseSharing() {
  window.electronAPI!.pauseSharing()
}

function resumeSharing() {
  window.electronAPI!.resumeSharing()
}

function stopSharing() {
  window.electronAPI!.stopSharing()
}

function shareDifferentScreen() {
  window.electronAPI!.openScreenSourceSelection()
}

function toggleClipboard() {
  window.electronAPI!.toggleClipboard()
}

function showInviteLink() {
  window.electronAPI!.showSharingActive()
}

function resizeWindow(data: { rect: DOMRect, oldRect: DOMRect | undefined }) {
  window.electronAPI?.resizeWindow('toolbar', {
    size: { width: Math.round(data.rect.width) },
    deltaSize: { width: data.oldRect ? Math.round(data.rect.width - (data.oldRect?.width ?? 0)) : 0 },
  })
}
</script>

<template>
  <PresenterToolbar
    ref="toolbar"
    :viewers="users"
    :clipboard-enabled="clipboardEnabled"
    draggable
    invert-collapse-icons
    @toggle-remote-control="toggleRemoteControl"
    @toggle-pointer="togglePointer"
    @pause-sharing="pauseSharing"
    @resume-sharing="resumeSharing"
    @stop-sharing="stopSharing"
    @share-different-screen="shareDifferentScreen"
    @toggle-clipboard="toggleClipboard"
    @show-invite-link="showInviteLink"
    @resize="resizeWindow"
  />
</template>

<style>
  @font-face {
    font-family: 'Abel';
    font-style: normal;
    font-weight: 400;
    src: local('Abel Regular'), local('Abel-Regular'), url('../../../assets/fonts/abel-v10-latin-regular.woff2') format('woff2');
  }

  html {
    background: transparent !important;
  }

  body {
    padding: 0px;
    overflow: hidden;
    background: transparent !important;
    height: 60px;
  }

  #toolbar {
    display: inline-block;
  }
</style>