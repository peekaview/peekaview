<script setup lang="ts">
import type { Signal } from "../../types"

defineProps<{
  signal: Signal
}>()
</script>

<template>
  <div class="signal-container" :style="{ left: signal.left, top: signal.top, 'background-color': signal.color }">
    <div class="cursorsignal" style="animation-delay: -1s"></div>
    <div class="cursorsignal" style="animation-delay: -0.5s"></div>
    <div class="cursorsignal" style="animation-delay: 0s"></div>
  </div>
</template>

<style>
.remote-viewer .signal-container {
  width: 300px;
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  display: none;
  position: absolute;
  z-index: 200;
  user-select: none;
  -webkit-user-select: none;
  clear: both;
  padding-top: 5px;
  pointer-events: none;
}
</style>