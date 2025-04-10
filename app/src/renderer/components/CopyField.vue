<script setup lang="ts">
import { ref } from 'vue'

import CopySvg from '../../assets/icons/content-copy.svg'

const props = defineProps<{
  text: string
}>()

const copied = ref(false)
let copyTimeout: number
function copyCode() {
  clearTimeout(copyTimeout)
  navigator.clipboard.writeText(props.text)
  copied.value = true
  copyTimeout = window.setTimeout(() => copied.value = false, 5000)
}
</script>

<template>
  <div class="copy-field" @click="copyCode">
    <CopySvg />
    <code>{{ text }}</code>
    <div class="mt-2" v-if="copied">{{ $t('general.copied') }}!</div>
  </div>
</template>

<style scoped>
.copy-field {
  --bs-code-color: white;
  cursor: pointer;
  border: 1px solid var(--bs-code-color);
  border-radius: 0.25rem;
  padding: 0.5em;
}

.copy-field svg {
  height: 1em;
  fill: var(--bs-code-color);
  padding: 0 0.5em;
}
</style>
