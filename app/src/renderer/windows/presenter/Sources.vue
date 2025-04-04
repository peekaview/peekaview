<script setup lang="ts">
import { computed, onMounted, ref, watch, defineModel } from 'vue'

import { ScreenSource } from '../../../interface'

import ScreenIcon from './img/screen.png'

const emit = defineEmits<{
  (e: 'select', source: ScreenSource): void
  (e: 'cancel'): void
}>()

const shareAudio = defineModel<boolean>('shareAudio', { required: false, default: false })

const sources = ref<ScreenSource[]>()
const selectedSource = ref<ScreenSource | undefined>()

const activeTab = ref<"windows" | "screens">("windows")
watch(activeTab, () => {
  selectedSource.value = undefined
})

const sourceGroups = computed(() => ({
  windows: sources.value?.filter(s => s.id.startsWith('window')) ?? [],
  screens: sources.value?.filter(s => s.id.startsWith('screen')) ?? [],
}))

onMounted(async () => {
  sources.value = await window.electronAPI!.getScreenSources()
})

function share() {
  if (!selectedSource.value)
    return

  emit('select', selectedSource.value)
}
</script>

<template>
  <div class="sources p-4 fade-in">
    <div class="tabs">
      <div v-for="(_group, type) in sourceGroups" class="tab" :class="{ active: activeTab === type }" @click="activeTab = type">
        <div class="p-2">{{ $t(`sourcesWindow.type.${type}`) }}</div>
      </div>
    </div>
    <div class="source-group p-2">
      <div v-for="source in sourceGroups[activeTab]" class="source-item" :class="{ selected: selectedSource?.id === source.id }" @click="selectedSource = source">
        <img :src="source.thumbnail ?? ScreenIcon" :alt="source.name">
        <p>{{ source.name }}</p>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary float-right" @click="$emit('cancel')">{{ $t('general.cancel') }}</button>
      <button class="btn btn-primary float-right" :disabled="!selectedSource" @click="share">{{ $t('sourcesWindow.share') }}</button>
    </div>
  </div>
</template>

<style>
#sources {
  height: 100%;
  min-height: 0;
}

.sources {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-height: 100%;
  min-height: 0;
}

.sources .tab.active {
  border-bottom-color: #224488;
}

.source-group {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  background-color: #141414;
  border-radius: 5px;
  min-height: calc(100vh - 155px);
}

.source-item {
  display: flex;
  flex-direction: column;
  justify-content: end;
  gap: 1rem;
  font-size: 0.75rem;
  padding: 1rem;
  cursor: pointer;
  width: 16em;
  height: 16em;
  border-radius: 5px;
}

.source-item.selected {
  background-color: #224488;
}

.source-item img {
  align-self: center;
  max-width: 12em;
  max-height: 8em;
}

.source-item p {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>