<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watchEffect } from 'vue'

const props = withDefaults(defineProps<{
  trackElement: HTMLMediaElement | undefined
  muted?: boolean
  playsInline?: boolean
}>(), {
  muted: false,
  playsInline: false,
})

const containerRef = useTemplateRef('container')
const _trackElement = ref<HTMLVideoElement>()

onMounted(() => {
  watchEffect(() => {
    detach()
    attach()
  })
})

onBeforeUnmount(() => detach())

function attach() {
  if (_trackElement.value)
    return

  _trackElement.value = props.trackElement as HTMLVideoElement
  _trackElement.value.muted = props.muted
  _trackElement.value.playsInline = props.playsInline
  _trackElement.value.style.maxWidth = '100%'
  _trackElement.value.style.maxHeight = '100%'
  _trackElement.value.style.width = '100%'
  _trackElement.value.style.height = '100%'
  _trackElement.value.style.objectFit = 'cover'
  
  containerRef.value?.append(_trackElement.value)
}

function detach() {
  _trackElement.value?.remove()
  _trackElement.value = undefined
}
</script>

<template>
  <div ref="container"></div>
</template>