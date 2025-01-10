<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{
  draggable?: boolean
}>(), {
  draggable: false
})

const isClosing = ref(false)

function close() {
  isClosing.value = true
  setTimeout(() => window.close(), 200)
}

defineExpose({
  close
})
</script>

<template>
  <div ref="modal" class="modal active modal-in" :class="{ 'modal-out': isClosing }">
    <div v-if="draggable" style="height: 15px; width: 100%; position: absolute; top: 0; left: 0; -webkit-app-region: drag;"></div>
    <div class="modal-container" >
      <div v-if="$slots.header" class="modal-header">
        <slot name="header" />
      </div>
      <div class="modal-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style>
  html, body, .modal {
    overflow: hidden;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: Abel;
  }
  
  .modal-container {
    -webkit-user-select: none;
    background: #1a1a1a;
    color: #EEE;
  }

  .modal-container .modal-header {
    color: white;
  }

  /* Colors and Fonts */
  .modal-container .btn {
    line-height: 20px;
    float: left;
    margin: 0px;
    padding: 4px
  }
  .modal-container .btn.btn-secondary {
    background: #2a2a2a;
    border-color: #404040;
    color: #aaa;
  }
  .modal-container .btn.btn-secondary:hover {
    background: #404040;
    border-color: #505050;
    color: #ddd;
  }

  .modal-in {
    animation-name: scale-in;
    animation-duration: 0.3s;
  }

  .modal-out {
    animation-name: scale-out;
    animation-duration: 0.2s;
    transform: translateY(-100%);
  }

  @keyframes scale-in {
    0% {
      transform: translateY(-100%);

    }

    100% {
      transform: translateY(0%);
    }
  }

  @keyframes scale-out {
    0% {
      transform: translateY(0%);
    }

    100% {
      transform: translateY(-100%);
    }
  }
</style>