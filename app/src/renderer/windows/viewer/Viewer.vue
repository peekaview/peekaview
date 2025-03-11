<script setup lang="ts">
import { ref } from 'vue'
import { ViewerData } from '../../types'
import Viewer from '../../views/viewer/Viewer.vue'
import ViewerForm from '../../views/form/ViewerForm.vue'
import { getStoredItem } from '../../util'

const formViewerData = ref<ViewerData>({ email: '', name: '' })
const activeViewerData = ref<ViewerData | undefined>()

getStoredItem('name').then(value => {
  if (value)
    formViewerData.value.name = value
})
</script>

<template>
  <Viewer
    v-if="activeViewerData"
    :contact="activeViewerData"
    @stop="activeViewerData = undefined"
  />
  <div v-else class="content-wrapper">
    <div class="section-content">
      <div class="text-center">
        <div class="panel">
          <ViewerForm
            v-model="formViewerData"
            @submit="activeViewerData = formViewerData"
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