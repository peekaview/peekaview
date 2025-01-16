<script setup lang="ts">
import { ref, onMounted } from 'vue'

import Clipboard from '../components/Clipboard.vue'

import { RemotePasteFileData } from '../../interface'

const fileData = ref<RemotePasteFileData | undefined>()

onMounted(() => {
  window.electronAPI?.clipboardReady()
  window.electronAPI?.dataToClipboard((data) => {
    fileData.value = JSON.parse(data)
  })
})

function close() {
  window.electronAPI?.closeClipboard()
}
</script>

<template>
  <Clipboard :file-data="fileData" draggable @close="close"/>
</template>

<style>
#clipboard {
  width: 100%;
  height: 100%;
}
</style>
