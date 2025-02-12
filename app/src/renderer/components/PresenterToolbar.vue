<script setup lang="ts">
import { ref, nextTick, useTemplateRef, watch } from 'vue'
import Toolbar from '../components/Toolbar.vue'

import ClipboardTextOutlineSvg from '../../assets/icons/clipboard-text-outline.svg'
import LogoutSvg from '../../assets/icons/logout.svg'
import AccountPlusOutlineSvg from '../../assets/icons/account-plus-outline.svg'
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

    const width = Math.round(rect.width) + 10
    const minimumWidth = Math.min(width, 175) // mac requires a bit of minimum width for window to stay transparent
    window.electronAPI!.resizeWindow('toolbar', {
      size: { width },
      minimumSize: { width: minimumWidth },
    })
  })
}
</script>

<template>
  <Toolbar ref="toolbar" class="main-toolbar" :collapsible="inApp" :draggable="draggable" poll-size @on-collapse="onCollapse">
    <label v-if="inApp" class="checkbox-container">
      <input type="checkbox" v-model="remoteControlEnabled" />
      <span class="checkmark"></span>
      <span class="checkbox-label">{{ $t('toolbar.remoteControl') }}</span>
    </label>
    <label class="checkbox-container">
      <input v-if="remoteControlEnabled" type="checkbox" checked disabled />
      <input v-else type="checkbox" v-model="mouseEnabled" />
      <span class="checkmark"></span>
      <span class="checkbox-label">{{ $t('toolbar.pointer') }}</span>
    </label>
    <div class="btn btn-sm btn-secondary" :title="$t('toolbar.openClipboard')" @click="$emit('toggle-clipboard')">
      <ClipboardTextOutlineSvg />
    </div>
    <div class="btn btn-sm btn-secondary" :title="$t('toolbar.shareDifferentScreen')" @click="$emit('share-different-screen')">
      <MonitorSvg />
    </div>
    <div class="btn btn-sm btn-secondary" :title="$t('toolbar.showInviteLink')" @click="$emit('show-invite-link')">
      <AccountPlusOutlineSvg />
    </div>
    <div class="btn btn-sm btn-secondary" :title="$t(`toolbar.${isPaused ? 'resume' : 'pause'}`)" @click="isPaused = !isPaused">
      <PlaySvg v-if="isPaused" />
      <PauseSvg v-else />
    </div>
    <div class="btn btn-sm btn-secondary" :title="$t('toolbar.stop')" @click="$emit('stop-sharing')">
      <LogoutSvg />
    </div>
  </Toolbar>
</template>