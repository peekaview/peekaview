<script setup lang="ts">
import { ref, nextTick, useTemplateRef, watch } from 'vue'
import Toolbar from '../components/Toolbar.vue'

import ClipboardTextOutlineSvg from '../../assets/icons/clipboard-text-outline.svg'
import CloseSvg from '../../assets/icons/close.svg'
import LinkSvg from '../../assets/icons/link.svg'
import MonitorSvg from '../../assets/icons/monitor.svg'
import PauseSvg from '../../assets/icons/pause.svg'
import PlaySvg from '../../assets/icons/play.svg'

withDefaults(defineProps<{
  draggable?: boolean
}>(), {
  draggable: false,
})

const emit = defineEmits<{
  (e: 'toggle-remote-control', enabled: boolean): void
  (e: 'toggle-mouse', enabled: boolean): void
  (e: 'toggle-clipboard'): void
  (e: 'pause-sharing'): void
  (e: 'resume-sharing'): void
  (e: 'stop-sharing'): void
  (e: 'share-different-screen'): void
  (e: 'show-invite-link'): void
}>()

const inApp = !!window.electronAPI
const remoteControlEnabled = ref(false)
const mouseEnabled = ref(true)
const isPaused = ref(false)
const toolbarRef = useTemplateRef('toolbar')

watch(remoteControlEnabled, (enabled) => emit('toggle-remote-control', enabled))
watch(mouseEnabled, (enabled) => emit('toggle-mouse', enabled))
watch(isPaused, (enabled) => enabled ? emit('pause-sharing') : emit('resume-sharing'))

function onCollapse() {
  if (!inApp)
    return

  nextTick(() => {
    const rect = toolbarRef.value?.$el.getBoundingClientRect()
    if (!rect)
      return

    const width = Math.round(rect.width)
    window.electronAPI!.resizeWindow('toolbar', {
      size: { width },
      minimumSize: { width },
    })
  })
}
</script>

<template>
  <Toolbar ref="toolbar" class="main-toolbar" :collapsible="inApp" :draggable="draggable" poll-size @on-collapse="onCollapse">
    <label v-if="inApp" class="checkbox-container">
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
    <div class="btn btn-sm btn-secondary" title="Toggle clipboard" style="width: 30px" @click="$emit('toggle-clipboard')">
      <ClipboardTextOutlineSvg />
    </div>
    <div class="btn btn-sm btn-secondary" title="Share different screen" style="width: 30px" @click="$emit('share-different-screen')">
      <MonitorSvg />
    </div>
    <div class="btn btn-sm btn-secondary" title="Show invite link" style="width: 30px" @click="$emit('show-invite-link')">
      <LinkSvg />
    </div>
    <div class="btn btn-sm btn-secondary" title="Pause / Resume" style="width: 30px" @click="isPaused = !isPaused">
      <PlaySvg v-if="isPaused" />
      <PauseSvg v-else />
    </div>
    <div class="btn btn-sm btn-secondary" title="Stop" style="width: 30px" @click="$emit('stop-sharing')">
      <CloseSvg />
    </div>
  </Toolbar>
</template>