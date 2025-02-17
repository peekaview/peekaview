<script setup lang="ts">
import { ref } from 'vue'
import { ViewerContact } from '../../types'
import Viewer from '../../views/viewer/Viewer.vue'

const activeViewerContact = ref<ViewerContact | undefined>()
</script>

<template>
  <Viewer
    v-if="activeViewerContact"
    :contact="activeViewerContact"
    @stop="activeViewerContact = undefined"
  />
  <div v-else class="content-wrapper">
    <div class="section-content">
      <div class="text-center">
        <div class="panel">
          <ViewerForm
            :model-value="activeViewerContact ?? { email: '', name: '' }"
            @update:model-value="activeViewerContact = $event"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style>
body {
  background-size: cover;
  background: repeating-conic-gradient(#1a1a1a 0% 25%, #202020 0% 50%) 50% / 20px 20px;
}
</style>