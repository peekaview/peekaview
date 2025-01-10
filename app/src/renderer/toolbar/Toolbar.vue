<script setup lang="ts">
import { ref, watch } from 'vue'
import Modal from '../components/Modal.vue'

const remoteControlEnabled = ref(true)
const mouseEnabled = ref(true)
const isPaused = ref(false)

watch(remoteControlEnabled, (flag) => window.electronAPI!.toggleRemoteControl(flag))
watch(mouseEnabled, (flag) => window.electronAPI!.toggleMouse(flag))
watch(isPaused, (flag) => {
  if (flag)
    window.electronAPI!.pauseSharing()
  else
    window.electronAPI!.resumeSharing()
})

function stopSharing() {
  window.electronAPI!.stopSharing()
}

function shareDifferentScreen() {
  window.electronAPI!.openScreenSourceSelection()
}

function showSharingActive() {
  window.electronAPI!.showSharingActive()
}
</script>

<template>
  <Modal draggable>
    <template #default>
      <div class="toolbar">
        <div class="btn btn-sm mr-1 btn-secondary" style="width: 110px; margin-bottom: 4px;">
          <label class="checkboxcontainer">
            &nbsp;&nbsp;Remote-Control
            <input type="checkbox" v-model="remoteControlEnabled" />
            <span class="checkmark"></span>
          </label>
        </div>
        <div class="btn btn-sm mr-1 btn-secondary" style="width: 110px">
          <label class="checkboxcontainer">
            &nbsp;&nbsp;Pointer
            <input v-if="remoteControlEnabled" type="checkbox" checked disabled />
            <input v-else type="checkbox" v-model="mouseEnabled" />
            <span class="checkmark"></span>
          </label>
        </div>
        <div class="btn btn-sm mr-1 btn-secondary" style="width: 30px" @click="shareDifferentScreen">
          <svg width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="#666" d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h3l-1 1v2h12v-2l-1-1h3c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
          </svg>
        </div>
        <div class="btn btn-sm mr-1 btn-secondary" style="width: 30px" @click="showSharingActive">
          <svg width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="#666" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
          </svg>
        </div>
        <div class="btn btn-sm mr-1 btn-secondary" style="width: 30px" @click="isPaused = !isPaused">
          <!-- Pause SVG -->
          <svg v-if="!isPaused" width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="#666" d="M6 4h4v16H6zm8 0h4v16h-4z"/>
          </svg>
          <!-- Play SVG (hidden by default) -->
          <svg v-else width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="#666" d="M8 5v14l11-7z"/>
          </svg>
        </div>
        <div class="btn btn-sm mr-1 btn-secondary" style="width: 30px" @click="stopSharing">
          <svg width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="#666" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </div>

        <div style="flex-grow: 1"></div>
        
        <div style="line-height: 20px; float:right; padding-bottom: 6px; padding-top: 6px; width: 16px; -webkit-user-select: none; -webkit-app-region: drag; display: flex; justify-content: center; align-items: center;">
          <svg width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="none" stroke="#ccc" stroke-width="2"
              d="M15,5 L17,5 L17,3 L15,3 L15,5 Z M7,5 L9,5 L9,3 L7,3 L7,5 Z M15,13 L17,13 L17,11 L15,11 L15,13 Z M7,13 L9,13 L9,11 L7,11 L7,13 Z M15,21 L17,21 L17,19 L15,19 L15,21 Z M7,21 L9,21 L9,19 L7,19 L7,21 Z" />
          </svg>
        </div>
      </div>
    </template>
  </Modal>
</template>

<style>
  .modal-container .modal-body {
    padding: 0px;
    padding-top: 4px;
  }
  .toolbar {
    display: flex;
    flex-wrap: nowrap;
  }
  .checkboxcontainer .checkmark:after {
    left: 5px;
    right: 3px;
    top: 2px;
  }
</style>