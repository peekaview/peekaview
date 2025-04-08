<script setup lang="ts">
import { nextTick, onMounted, ref, useTemplateRef } from 'vue'

import PresenterToolbar from '../../components/PresenterToolbar.vue'

import { UserData } from '../../../interface'

const toolbarRef = useTemplateRef<InstanceType<typeof PresenterToolbar>>('toolbar')

const users = ref<UserData[]>([])

const clipboardEnabled = ref(false)

const leftMargin = 20

window.electronAPI?.onClipboardEnabled(() => {
  clipboardEnabled.value = true
})

window.electronAPI?.onUpdateOverlayData((data) => {
  data.users !== undefined && (users.value = data.users)
  data.toolsEnabled !== undefined && toolbarRef.value?.togglePointer(data.toolsEnabled.pointer)
  data.toolsEnabled !== undefined && toolbarRef.value?.toggleRemoteControl(data.toolsEnabled.remoteControl)
})

onMounted(() => resizeWindow())

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

let oldRect: DOMRect
function resizeWindow() {
  console.log('resizeWindow', toolbarRef.value?.$el, toolbarRef.value?.toolbarRef?.$el)
  const rect = toolbarRef.value?.toolbarRef?.$el.getBoundingClientRect() as DOMRect
  if (!rect)
    return

  window.electronAPI?.resizeWindow('toolbar', {
    size: { width: Math.round(rect.width + leftMargin) },
    deltaSize: { width: oldRect ? Math.round(rect.width - (oldRect?.width ?? 0)) : 0 },
  })
  oldRect = rect
}

function onCollapse() {
  nextTick(() => resizeWindow())
}
</script>

<template>
  <PresenterToolbar
    ref="toolbar"
    :viewers="users"
    :clipboard-enabled="clipboardEnabled"
    draggable
    invert-collapse-icons
    :style="{ 'margin-left': leftMargin + 'px' }"
    @toggle-remote-control="toggleRemoteControl"
    @toggle-pointer="togglePointer"
    @pause-sharing="pauseSharing"
    @resume-sharing="resumeSharing"
    @stop-sharing="stopSharing"
    @share-different-screen="shareDifferentScreen"
    @toggle-clipboard="toggleClipboard"
    @show-invite-link="showInviteLink"
    @on-collapse="onCollapse"
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