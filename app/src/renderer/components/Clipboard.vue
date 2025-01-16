<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { RemotePasteFileData } from '../../interface.js'
import { b64DecodeUnicode } from "../util.js"

import ArrowCollapseVerticalSvg from '../../assets/icons/arrow-collapse-vertical.svg'
import ArrowExpandVerticalSvg from '../../assets/icons/arrow-expand-vertical.svg'
import CloseSvg from '../../assets/icons/close.svg'
import CopySvg from '../../assets/icons/content-copy.svg'
import DownloadSvg from '../../assets/icons/download.svg'
import Toolbar from './Toolbar.vue'

type ClipboardFile = {
  type: 'text' | 'image' | 'binary'
  name?: string
  extension: string
  content: string
}

const props = withDefaults(defineProps<{
  fileData: RemotePasteFileData | undefined
  draggable?: boolean
}>(), {
  fileData: undefined,
  draggable: false
})

const emit = defineEmits<{
  (e: 'onCollapse', collapsed: boolean): void
  (e: 'close'): void
}>()

const imageRef = useTemplateRef('image')
const downloadRef = useTemplateRef('download')
const downloadData = ref<{
  name: string
  content: string
} | undefined>()

const clipboardFile = ref<ClipboardFile | undefined>()
const collapsed = ref(false)

watch(collapsed, value => emit('onCollapse', value))

// virtuelles Clipboard, Filesharing via Websockets
// Todo, in eigene JS auslagern, da mehr oder weniger baugleich mit Filesharing in meetzi-App
watch(() => props.fileData, (data) => {
  if (!data) {
    clipboardFile.value = undefined
    return
  }

  if (data.filecontent.startsWith('data:application/octet-stream')) {
    try {
      b64DecodeUnicode(data.filecontent.replace('data:application/octet-streambase64,', ''))
    } catch (e) {
      data.filecontent = data.filecontent.replace('data:application/octet-stream', 'data:application/bin')
    }
  }

  let type: 'text' | 'image' | 'binary'
  let content = data.filecontent
  const mime = data.filecontent.split('data:')[1].split('base64,')[0]
  let extension = mime.split('/')[1]

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

    if (data.filename != undefined) {
      extension = data.filename.split('.').pop() ?? extension
    }
  }
  else if (content.startsWith('data:image/')) {
    type = 'image'
    // Wenns ein Bild ist, aber mime-Extension Sonderzeichen enthält, dann ists irgendein komisches Format und wir nehmen png als Default
    if (extension.includes('.') || extension.includes('-')) {
      extension = 'png'
    }

    // Wenn per Drag&Drop kommt, ist der Filename bekannt, dann darauf die Extension bestimmen
    if (data.filename !== undefined) {
      extension = data.filename.split('.').pop() ?? extension
    }
  }
  else {
    type = 'binary'
    extension = extension.replace('x-msdownload', 'exe')
    extension = extension.replace('x-zip-compressed', 'zip')

    if (extension.includes('.') || extension.includes('-')) {
      extension = 'bin'
    }

    if (data.filename != undefined) {
      extension = data.filename.split('.').pop() ?? extension
    }
  }

  clipboardFile.value = {
    type: type,
    name: data.filename,
    content: content,
    extension: extension
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

function close() {
  clipboardFile.value = undefined
  emit('close')
}
</script>

<template>
  <div v-if="clipboardFile" class="clipboard" :class="{ collapsed: collapsed }">
    <Toolbar :draggable="draggable">
      <div class="btn btn-sm btn-secondary" title="Collapse / Expand" style="width: 30px" @click="collapsed = !collapsed">
        <ArrowExpandVerticalSvg v-if="collapsed" />
        <ArrowCollapseVerticalSvg v-else />
      </div>
      <div class="btn btn-sm btn-secondary" title="Close" @click="close">
        <CloseSvg />
      </div>
    </Toolbar>
    <template v-if="!collapsed">
      <div v-if="clipboardFile.type === 'text'" class="clipboard-content" :style="{ backgroundImage: `url(icons/${clipboardFile.extension}.svg)` }">
        <textarea>{{ clipboardFile.content }}</textarea>
      </div>
      <div v-else>
        <img
          ref="image"
          :class="clipboardFile.type === 'binary' ? 'binary' : 'image'"
          :src="clipboardFile.type === 'binary' ? `icons/${clipboardFile.extension}.svg` : clipboardFile.content"
          @click="download"
        />
      </div>
      <Toolbar>
        <div v-if="clipboardFile?.type === 'image' || clipboardFile?.type === 'text'" class="btn btn-sm btn-secondary" title="Copy to clipboard" @click="copy">
          <CopySvg />
        </div>
        <div class="btn btn-sm btn-secondary" title="Download" @click="download">
          <DownloadSvg />
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
      </Toolbar>
    </template>
  </div>
</template>

<style>
.clipboard {
  display: flex;
  flex-direction: column;
  min-width: 10rem;
  width: 100%;
  height: 100%;
  padding: 5px;
  border-radius: 5px;
  background: #1a1a1a;
}

.clipboard.collapsed {
  height: auto;
}

.clipboard .toolbar .btn {
  flex: 1;
}
  
.clipboard .clipboard-content {
  flex-grow: 1;
  background-repeat: 'no-repeat';
  background-position-x: 'right';
}
  
.clipboard textarea {
  width: 100%;
  height: 100%;
  font-size: 10px;
  font-family: sans-serif;
  background: black;
  color: white;
  border: none;
  outline: none;
  resize: none;
  overflow: auto;
  -webkit-box-shadow: none;
  -moz-box-shadow: none;
  box-shadow: none;
}

.clipboard textarea::-webkit-scrollbar {
  display: none;
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
</style>