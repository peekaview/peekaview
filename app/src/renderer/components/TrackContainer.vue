<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watchEffect } from 'vue'

const props = withDefaults(defineProps<{
  getTrackElement: () => HTMLMediaElement | undefined
  muted?: boolean
  playsInline?: boolean
}>(), {
  muted: false,
  playsInline: false,
})

const containerRef = useTemplateRef('container')
const trackElement = ref<HTMLVideoElement>()

onMounted(() => {
  watchEffect(() => {
    detach()
    attach()
  })
})

onBeforeUnmount(() => detach())

function attach() {
  if (trackElement.value)
    return

  trackElement.value = props.getTrackElement() as HTMLVideoElement
  trackElement.value.muted = props.muted
  trackElement.value.playsInline = props.playsInline

  containerRef.value?.append(trackElement.value)
}

function detach() {
  trackElement.value?.remove()
  trackElement.value = undefined
}
</script>

<template>
  <div ref="container"></div>
</template>