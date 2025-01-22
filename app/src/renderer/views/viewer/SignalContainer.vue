<script setup lang="ts">
import type { Signal } from "../../types"

defineProps<{
  signal: Signal
}>()
</script>

<template>
  <div class="signal-container" :style="{ left: (signal.left - 150) + 'px', top: (signal.top - 150) + 'px', 'background-color': signal.color }">
    <div class="signal" style="animation-delay: -1s"></div>
    <div class="signal" style="animation-delay: -0.5s"></div>
    <div class="signal" style="animation-delay: 0s"></div>
  </div>
</template>

<style>
.signal-container {
  width: 300px;
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: absolute;
  z-index: 200;
  user-select: none;
  -webkit-user-select: none;
  clear: both;
  padding-top: 5px;
  pointer-events: none;
}

.signal-container .signal {
  border-radius: 50%;
  width: 50px;
  background-color: red;
  height: 50px;
  position: absolute;
  opacity: 0;
  animation: scaleIn 1s infinite cubic-bezier(.36, .11, .89, .32);
}
</style>