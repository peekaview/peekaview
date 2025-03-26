<script setup lang="ts">
import { ref, computed, nextTick, onMounted, useTemplateRef, watch } from 'vue'
import { Tooltip } from 'floating-vue'

import Toolbar from '../components/Toolbar.vue'

import ClipboardTextOutlineSvg from '../../assets/icons/clipboard-text-outline.svg'
import LogoutSvg from '../../assets/icons/logout.svg'
import AccountGroupSvg from '../../assets/icons/account-group.svg'
import AccountPlusOutlineSvg from '../../assets/icons/account-plus-outline.svg'
import MonitorSvg from '../../assets/icons/monitor.svg'
import PauseSvg from '../../assets/icons/pause.svg'
import PlaySvg from '../../assets/icons/play.svg'
import { UserData } from '../../interface'

const props = withDefaults(defineProps<{
  viewers?: UserData[]
  draggable?: boolean
  invertCollapseIcons?: boolean
  clipboardEnabled?: boolean
}>(), {
  draggable: false,
  invertCollapseIcons: false,
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
  (e: 'resize', data: { rect: DOMRect, oldRect: DOMRect | undefined }): void
}>()

const viewersLog = ref<{ id: number, joined: boolean, name: string, timeout: number }[]>([])

let logId = 0
watch(() => props.viewers, (viewers, oldViewers) => {
  for (const viewer of viewers || []) {
    if (!oldViewers || !oldViewers.find(v => v.id === viewer.id)) {
      viewersLog.value.push({
        id: logId++,
        joined: true,
        name: (viewer.name || viewer.email)!,
        timeout: Date.now() + 5000,
      })
    }
  }

  for (const viewer of oldViewers || []) {
    if (!viewers || !viewers.find(v => v.id === viewer.id)) {
      viewersLog.value.push({
        id: logId++,
        joined: false,
        name: (viewer.name || viewer.email)!,
        timeout: Date.now() + 5000,
      })
    }
  }
})
setInterval(() => viewersLog.value = viewersLog.value.filter(log => log.timeout > Date.now()), 1000)

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

onMounted(() => resizeWindow())

function onCollapse() {
  nextTick(() => resizeWindow())
}

let oldRect: DOMRect
function resizeWindow() {
  const rect = toolbarRef.value?.$el.getBoundingClientRect() as DOMRect
  if (!rect)
    return

  emit('resize', { rect, oldRect })
  oldRect = rect
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
  <Toolbar ref="toolbar" class="main-toolbar" :collapsible="inApp" :draggable="draggable" :invert-collapse-icons="invertCollapseIcons" @on-collapse="onCollapse">
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
    <Tooltip
      v-if="viewers"
      class="viewer-count"
      :class="{ 'viewer-count-none': viewers.length === 0 }"
      :triggers="[]"
      :shown="Object.keys(viewersLog).length > 0"
    >
      <AccountGroupSvg />
      <span>{{ viewers.length }}</span>
      <template #popper>
        <div class="viewer-log">
          <span v-for="(viewer) in viewersLog" :key="viewer.id">
            {{ $t(`toolbar.viewer${viewer.joined ? 'Joined' : 'Left'}`, { name: viewer.name }) }}
          </span>
        </div>
      </template>
    </Tooltip>
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

.viewer-log {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.8rem;
}
</style>
