<script setup lang="ts">
import PresenterToolbar from '../../components/PresenterToolbar.vue'

function toggleRemoteControl(enabled: boolean) {
  window.electronAPI!.toggleRemoteControl(enabled)
}

function toggleMouse(enabled: boolean) {
  window.electronAPI!.toggleMouse(enabled)
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
    draggable
    @toggle-remote-control="toggleRemoteControl"
    @toggle-mouse="toggleMouse"
    @pause-sharing="pauseSharing"
    @resume-sharing="resumeSharing"
    @stop-sharing="stopSharing"
    @share-different-screen="shareDifferentScreen"
    @toggle-clipboard="toggleClipboard"
    @show-invite-link="showInviteLink"
  />
</template>

<style>
  body {
    padding: 5px;
    overflow: hidden;
  }

  #toolbar {
    display: inline-block;
  }
</style>