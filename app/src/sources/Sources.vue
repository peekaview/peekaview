<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { ScreenSource } from '../interface'

const sources = ref<ScreenSource[]>()
const selectedSourceId = ref<string | undefined>()

const activeTab = ref<"windows" | "screens">("windows")

const sourceGroups = computed(() => ({
  windows: sources.value?.filter(s => s.id.startsWith('window')) ?? [],
  screens: sources.value?.filter(s => s.id.startsWith('screen')) ?? [],
}))

onMounted(async () => {
  sources.value = await window.electronAPI!.getScreenSources()
})

function share() {
  selectedSourceId.value && window.electronAPI!.selectScreenSourceId(selectedSourceId.value)
}

function cancel() {
  // TODO
}
</script>

<template>
  <div class="sources p-4 fade-in">
    <div class="source-tabs">
      <div v-for="(_group, type) in sourceGroups" class="source-tab" :class="{ active: activeTab === type }" @click="activeTab = type">
        <div class="p-2">{{ $t(`sourcesWindow.type.${type}`) }}</div>
      </div>
    </div>
    <div class="source-group p-2">
      <div v-for="source in sourceGroups[activeTab]" class="source-item" :class="{ selected: selectedSourceId === source.id }" @click="selectedSourceId = source.id">
        <img :src="source.thumbnail" :alt="source.name">
        <p>{{ source.name }}</p>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary float-right" @click="cancel">{{ $t('general.cancel') }}</button>
      <button class="btn btn-primary float-right" :disabled="!selectedSourceId" @click="share">{{  $t('sourcesWindow.share') }}</button>
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

.source-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 1rem;
}

.source-tab {
  cursor: pointer;
}

.source-tab.active {
  font-weight: bold;
  border-bottom: 3px solid blue;
}

.source-group {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid #ddd
}

.source-item {
  display: flex;
  flex-direction: column;
  justify-content: end;
  border: 1px solid #ccc;
  padding: 1rem;
  cursor: pointer;
  width: 200px;
  height: 200px;
}

.source-item.selected {
  border-color: blue;
  background-color: #dddddd;
}

.source-item img {
  align-self: center;
  max-width: 192px;
  max-height: 108px;
}

.source-item p {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-row {
  flex: 0 0 auto;
  display: flex;
  justify-content: end;
  gap: 0.5rem;
}
</style>