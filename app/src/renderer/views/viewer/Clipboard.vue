<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { b64DecodeUnicode } from "../../util.js"

type ClipboardFile = {
  type: 'text' | 'image' | 'binary'
  name?: string
  extension: string
  content: string
}

const props = withDefaults(defineProps<{
  data: {
    content: string
    name: string | undefined
  } | undefined
}>(), {
  data: undefined,
})

const imageRef = useTemplateRef('image')
const downloadRef = useTemplateRef('download')
const downloadData = ref<{
  name: string
  content: string
} | undefined>()

const clipboardFile = ref<ClipboardFile | undefined>()

// virtuelles Clipboard, Filesharing via Websockets
// Todo, in eigene JS auslagern, da mehr oder weniger baugleich mit Filesharing in meetzi-App
watch(() => props.data, (data) => {
  if (!data) {
    clipboardFile.value = undefined
    return
  }

  let content = data.content
  let name = data.name
  if (content.startsWith('data:application/octet-stream')) {
    try {
      b64DecodeUnicode(content.replace('data:application/octet-streambase64,', ''))
    } catch (e) {
      content = content.replace('data:application/octet-stream', 'data:application/bin')
    }
  }

  const mime = content.split('data:')[1].split('base64,')[0]
  let extension = mime.split('/')[1]
  let type: 'text' | 'image' | 'binary'

  if (content.startsWith('data:application/octet-stream') || content.startsWith('data:text/') || content.startsWith('data:application/json')) {
    type = 'text'
    if (content.startsWith('data:application/octet-stream')) {
      content = b64DecodeUnicode(content.replace('data:application/octet-streambase64,', ''))
    } else {
      content = atob(content.split('base64,')[1])
    }
    if (content.includes('<?php')) {
      extension = 'php'
    }
    if (extension.includes('.') || extension.includes('-')) {
      extension = 'txt'
    }

    if (name != undefined) {
      extension = name.split('.').pop() ?? extension
    }
  }
  else if (content.startsWith('data:image/')) {
    type = 'image'
    // Wenns ein Bild ist, aber mime-Extension Sonderzeichen enthält, dann ists irgendein komisches Format und wir nehmen png als Default
    if (extension.includes('.') || extension.includes('-')) {
      extension = 'png'
    }

    // Wenn per Drag&Drop kommt, ist der Filename bekannt, dann darauf die Extension bestimmen
    if (name !== undefined) {
      extension = name.split('.').pop() ?? extension
    }
  }
  else {
    type = 'binary'
    extension = extension.replace('x-msdownload', 'exe')
    extension = extension.replace('x-zip-compressed', 'zip')

    if (extension.includes('.') || extension.includes('-')) {
      extension = 'bin'
    }

    if (name != undefined) {
      extension = name.split('.').pop() ?? extension
    }
  }

  clipboardFile.value = {
    type,
    name,
    content,
    extension
  }
}, { immediate: true })

function download() {
  console.log('download', clipboardFile.value)
  if (!clipboardFile.value)
    return

  const datestring = (new Date().toLocaleString().replaceAll('/', '-').replaceAll(', ', '_').replaceAll(':', '-'))
  downloadData.value = {
    content: clipboardFile.value.content,
    name: clipboardFile.value.name ?? 'download_' + datestring + '.' + clipboardFile.value.extension
  }
  console.log(downloadData.value)
  downloadRef.value?.click()
  nextTick(() => {
    downloadData.value = undefined
  })
}

function copy() {
  switch (clipboardFile.value?.type) {
    case 'text':
      navigator.clipboard.writeText(clipboardFile.value.content)
      break
    case 'image':
      const canvas = document.createElement('canvas')
      canvas.width = imageRef.value!.naturalWidth
      canvas.height = imageRef.value!.naturalHeight
      const context = canvas.getContext('2d')!
      context.drawImage(imageRef.value!, 0, 0)
      canvas.toBlob(async (blob) => {
        await navigator.clipboard.write([
          new ClipboardItem({
            [blob!.type]: blob!
          })
        ])
        console.log('Copied')
      })
      break
    default:
      break
  }
}
</script>

<template>
  <div v-if="clipboardFile" class="clipboard">
    <div class="button" style="margin-bottom: 5px" @click="clipboardFile = undefined">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </div>
    <div v-if="clipboardFile?.type === 'image' || clipboardFile?.type === 'text'" class="button copy-button" @click="copy">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </div>
    <div class="button download-button">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    </div>
    <div>
      <div v-if="clipboardFile.type === 'text'" :style="{ backgroundImage: `url(icons/${clipboardFile.extension}.svg)`, 'background-repeat': 'no-repeat', 'background-position-x': 'right' }">
        <textarea>{{ clipboardFile.content }}</textarea>
      </div>
      <img
        v-else
        ref="image"
        :class="clipboardFile.type === 'binary' ? 'binary' : 'image'"
        :src="clipboardFile.type === 'binary' ? `icons/${clipboardFile.extension}.svg` : clipboardFile.content"
        @click="download"
      />
    </div>
    <a
      ref="download"
      v-if="downloadData"
      :href="downloadData.content"
      :download="downloadData.name"
      target="_self"
    >
      {{ downloadData.name }}
    </a>
  </div>
</template>

<style>
.clipboard {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 160px;
    height: 200px;
    padding: 5px;
    border-radius: 5px;
    background: #1a1a1a;
    z-index: 300;
}

.clipboard img {
  text-align: center;
}

.clipboard img.image {
  max-height: 120px;
  max-width: 140px;
  opacity: 0.8;
}

.clipboard img.binary {
  max-height: 150px;
}

.clipboard .copy-button, .clipboard .download-button {
    position: absolute;
    z-index: 10;
    width: calc(100% - 10px);
    margin-top: 5px;
}

.clipboard .copy-button {
    display: none;
    bottom: 40px;
}

.clipboard .download-button {
    display: inline;
    bottom: 10px;
}
</style>