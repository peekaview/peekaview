<script setup lang="ts">
import { ref, nextTick, onMounted, useTemplateRef } from 'vue'

import Clipboard from '../../components/Clipboard.vue'

import { File } from '../../../interface'

const file = ref<File>({ content: 'data:text/plain;base64,' })

const clipboardRef = useTemplateRef<InstanceType<typeof Clipboard>>('clipboard')

onMounted(() => {
  window.electronAPI?.clipboardReady()
  window.electronAPI?.dataToClipboard((data) => {
    file.value = JSON.parse(data)
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
  window.electronAPI?.toggleClipboard(false)
}
</script>

<template>
  <Clipboard ref="clipboard" :data="file" draggable @close="close" @on-collapse="onCollapse"/>
</template>

<style>
body {
  padding: 5px;
  overflow: hidden;
}

#clipboard {
  width: 100%;
  height: 100%;
}
</style>
