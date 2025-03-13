<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import PresenterToolbar from '../../components/PresenterToolbar.vue'
import { UserData } from '../../../interface'

const toolbar = useTemplateRef<InstanceType<typeof PresenterToolbar>>('toolbar')

const users = ref<UserData[]>([])

window.electronAPI!.onTogglePointer((enabled?: boolean) => {
  toolbar.value?.togglePointer(enabled)
})

window.electronAPI!.onToggleRemoteControl((enabled?: boolean) => {
  toolbar.value?.toggleRemoteControl(enabled)
})

window.electronAPI!.onUpdateOverlayData((data) => {
  data.users !== undefined && (users.value = data.users)
  data.pointerEnabled !== undefined && toolbar.value?.togglePointer(data.pointerEnabled)
  data.remoteControlEnabled !== undefined && toolbar.value?.toggleRemoteControl(data.remoteControlEnabled)
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
</script>

<template>
  <PresenterToolbar
    ref="toolbar"
    :viewer-count="users.length"
    draggable
    @toggle-remote-control="toggleRemoteControl"
    @toggle-pointer="togglePointer"
    @pause-sharing="pauseSharing"
    @resume-sharing="resumeSharing"
    @stop-sharing="stopSharing"
    @share-different-screen="shareDifferentScreen"
    @toggle-clipboard="toggleClipboard"
    @show-invite-link="showInviteLink"
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
    padding: 5px;
    overflow: hidden;
    background: transparent !important;
  }

  #toolbar {
    display: inline-block;
  }
</style>