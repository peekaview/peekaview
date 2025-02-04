<script setup lang="ts">
import CursorPng from '../../assets/img/cursor.png'

withDefaults(defineProps<{
  name?: string
  color: string
  left: number
  top: number
  scale?: number
  isSelf?: boolean
}>(), {
  scale: 1,
  isSelf: false
})
</script>

<template>
  <div class="cursor" :style="{ left: (left * scale) + 'px', top: (top * scale) + 'px' }">
    <img :src="CursorPng"/>
    <div v-if="!isSelf && name" class="cursor-name" :style="{ border: `1px solid #${color}`, color: `#${color}` }">{{ name }}</div>
  </div>
</template>

<style>
.cursor {
  transition: all 0.05s ease-out;
  pointer-events: none;
  float: left;
  width: 300px;
  position: absolute;
  z-index: 99;
}

.cursor img {
  float: left;
  height: 25px;
  width: 25px;
}

.cursor .cursor-name {
  float: left;
  width: auto;
  margin-left: 10px;
  margin-top: 10px;
  background: white;
  font-size: 12px;
  padding: 4px;
}
</style>