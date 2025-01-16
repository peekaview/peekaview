<script setup lang="ts">
import { ref, nextTick, onMounted, useTemplateRef } from 'vue'

import Clipboard from '../components/Clipboard.vue'

import { RemotePasteFileData } from '../../interface'

const fileData = ref<RemotePasteFileData | undefined>()

const clipboardRef = useTemplateRef('clipboard')

onMounted(() => {
  window.electronAPI?.clipboardReady()
  window.electronAPI?.dataToClipboard((data) => {
    fileData.value = JSON.parse(data)
  })
})

function onCollapse(collapsed: boolean) {
  nextTick(() => {
    const rect = clipboardRef.value?.$el.getBoundingClientRect()
    if (!rect)
      return

    window.electronAPI!.resizeWindow('clipboard', {
      size: {
        height: collapsed ? Math.round(rect.height) : 320,
      },
    })
  })
}

function close() {
  window.electronAPI?.closeClipboard()
}
</script>

<template>
  <Clipboard ref="clipboard" :file-data="fileData" draggable @close="close" @on-collapse="onCollapse"/>
</template>

<style>
#clipboard {
  width: 100%;
  height: 100%;
}
</style>
