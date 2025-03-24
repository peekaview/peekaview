<script setup lang="ts">
import { ref, computed, nextTick, onMounted, useTemplateRef, watch, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { Tooltip } from 'floating-vue'

import Toolbar from '../components/Toolbar.vue'

import ClipboardTextOutlineSvg from '../../assets/icons/clipboard-text-outline.svg'
import LogoutSvg from '../../assets/icons/logout.svg'
import AccountGroupSvg from '../../assets/icons/account-group.svg'
import AccountPlusOutlineSvg from '../../assets/icons/account-plus-outline.svg'
import MonitorSvg from '../../assets/icons/monitor.svg'
import PauseSvg from '../../assets/icons/pause.svg'
import PlaySvg from '../../assets/icons/play.svg'
import { getPlatform } from '../util'
import { UserData } from '../../interface'

const props = withDefaults(defineProps<{
  viewers?: UserData[]
  draggable?: boolean
  clipboardEnabled?: boolean
}>(), {
  draggable: false,
  clipboardEnabled: false,
})

const emit = defineEmits<{
  (e: 'toggle-remote-control', enabled: boolean): void
  (e: 'toggle-pointer', enabled: boolean): void
  (e: 'toggle-clipboard'): void
  (e: 'pause-sharing'): void
  (e: 'resume-sharing'): void
  (e: 'stop-sharing'): void
  (e: 'share-different-screen'): void
  (e: 'show-invite-link'): void
}>()

const { t } = useI18n()

const viewersLog = ref<{ joined: boolean, name: string, timeout: number }[]>([])
const viewersTooltip = computed(() => 
  viewersLog.value
    .map(({ joined, name }) => t(`toolbar.viewer${joined ? 'Joined' : 'Left'}`, { name }))
    .join('<br>')
)
watch(() => props.viewers, (viewers) => {
  console.log("viewers", toRaw(viewers))
}, { immediate: true })
watch(viewersLog, (viewersLog) => {
  console.log("viewersLog", toRaw(viewersLog))
}, { immediate: true })

watch(() => props.viewers, (viewers, oldViewers) => {
  for (const viewer of viewers || []) {
    if (!oldViewers || !oldViewers.find(v => v.id === viewer.id)) {
      viewersLog.value.push({
        joined: true,
        name: (viewer.name || viewer.email)!,
        timeout: Date.now() + 5000,
      })
    }
  }

  for (const viewer of oldViewers || []) {
    if (!viewers || !viewers.find(v => v.id === viewer.id)) {
      viewersLog.value.push({
        joined: false,
        name: (viewer.name || viewer.email)!,
        timeout: Date.now() + 5000,
      })
    }
  }
})
//setInterval(() => viewersLog.value = viewersLog.value.filter(log => log.timeout > Date.now()), 1000)

const macMinimumWidth = 160

const isMac = getPlatform() === 'mac'
const inApp = !!window.electronAPI
const toolbarRef = useTemplateRef('toolbar')

const _pointerEnabled = ref(true)
const pointerEnabled = computed({
  get: () => _pointerEnabled.value,
  set: (enabled) => {
    emit('toggle-pointer', enabled)
    _pointerEnabled.value = enabled
  },
})

const _remoteControlEnabled = ref(false)
const remoteControlEnabled = computed({
  get: () => _remoteControlEnabled.value,
  set: (enabled) => {
    emit('toggle-remote-control', enabled)
    _remoteControlEnabled.value = enabled
  },
})

const isPaused = ref(false)
watch(isPaused, (enabled) => enabled ? emit('pause-sharing') : emit('resume-sharing'))

setInterval(() => {
  const rect = toolbarRef.value?.$el.getBoundingClientRect()
  if (!rect)
    return
  
  window.electronAPI?.setToolbarSize(Math.round(rect.width + 10), Math.round(rect.height + 10))
}, 500)

onMounted(() => resizeWindow())

function onCollapse() {
  if (!inApp)
    return

  nextTick(() => resizeWindow())
}

function resizeWindow() {
  const rect = toolbarRef.value?.$el.getBoundingClientRect()
  if (!rect)
    return

  const width = Math.round(rect.width) + 10
  const minimumWidth = Math.min(width, isMac ? macMinimumWidth : width) // mac requires a specific minimum width for the window to stay transparent
  window.electronAPI?.resizeWindow('toolbar', {
    size: { width },
    minimumSize: { width: minimumWidth },
  })
}

function togglePointer(enabled?: boolean) {
  if (enabled === undefined)
    enabled = !_pointerEnabled.value

  _pointerEnabled.value = enabled
}

function toggleRemoteControl(enabled?: boolean) {
  if (enabled === undefined)
    enabled = !_remoteControlEnabled.value

  _remoteControlEnabled.value = enabled
}

defineExpose({
  togglePointer,
  toggleRemoteControl,
})
</script>

<template>
  <Toolbar ref="toolbar" class="main-toolbar" :collapsible="inApp" :draggable="draggable" @on-collapse="onCollapse">
    <label class="checkbox-container">
      <input type="checkbox" v-model="pointerEnabled" />
      <span class="checkmark"></span>
      <span class="checkbox-label">{{ $t('toolbar.pointer') }}</span>
    </label>
    <label v-if="inApp" class="checkbox-container">
      <input type="checkbox" v-model="remoteControlEnabled" />
      <span class="checkmark"></span>
      <span class="checkbox-label">{{ $t('toolbar.remoteControl') }}</span>
    </label>
    <div v-if="viewers" class="viewer-count" :class="{ 'viewer-count-none': viewers.length === 0 }">
      <Tooltip
        :triggers="[]"
        :shown="Object.keys(viewersLog).length > 0"
      >
        <AccountGroupSvg />
        <span>{{ viewers.length }}</span>
        <template #popper>
          <span v-html="viewersTooltip" />
        </template>
      </Tooltip>
    </div>
    <div class="btn btn-sm btn-secondary" :class="{ disabled: !clipboardEnabled }" :title="$t('toolbar.openClipboard')" @click="clipboardEnabled && $emit('toggle-clipboard')">
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

<style>
.viewer-count {
  display: flex;
  align-items: center;
  padding: 0.5rem;
  gap: 0.5rem;
}

.viewer-count svg {
  width: 1rem;
}

.viewer-count span:first-child {
  font-weight: bold; 
}

.viewer-count-none {
  color: #f00;
}

.viewer-count-none svg {
  fill: #f00;
}
</style>
