<script setup lang="ts">
import { ref, watch } from 'vue'

import ArrowCollapseHorizontalSvg from '../../assets/icons/arrow-collapse-horizontal.svg'
import ArrowExpandHorizontalSvg from '../../assets/icons/arrow-expand-horizontal.svg'

const props = withDefaults(defineProps<{
  draggable?: boolean
  collapsible?: boolean
}>(), {
  draggable: false,
  collapsible: false
})

const collapsed = ref(false)

watch(() => props.collapsible, flag => !flag && (collapsed.value = false))
</script>

<template>
  <div class="toolbar">
    <div v-if="draggable" style="height: 15px; width: 100%; position: absolute; top: 0; left: 0; -webkit-app-region: drag;"></div>

    <template v-if="!collapsed">
      <slot />
      <div style="flex-grow: 1"></div>
    </template>

    <div v-if="collapsible" class="btn btn-sm btn-secondary" title="Collapse / Expand" style="width: 30px" @click="collapsed = !collapsed">
      <ArrowExpandHorizontalSvg v-if="collapsed" />
      <ArrowCollapseHorizontalSvg v-else />
    </div>
    <div v-if="draggable" style="line-height: 20px; float:right; padding-bottom: 6px; padding-top: 6px; width: 16px; -webkit-user-select: none; -webkit-app-region: drag; display: flex; justify-content: center; align-items: center;">
      <svg width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path fill="none" stroke="#ccc" stroke-width="2"
          d="M15,5 L17,5 L17,3 L15,3 L15,5 Z M7,5 L9,5 L9,3 L7,3 L7,5 Z M15,13 L17,13 L17,11 L15,11 L15,13 Z M7,13 L9,13 L9,11 L7,11 L7,13 Z M15,21 L17,21 L17,19 L15,19 L15,21 Z M7,21 L9,21 L9,19 L7,19 L7,21 Z" />
      </svg>
    </div>
  </div>
</template>

<style>
  .toolbar {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.5em;
    -webkit-user-select: none;
    background: #1a1a1a;
    color: #EEE;
    padding: 4px;
    min-width: 0;
  }
  .toolbar svg {
    fill: #666;
  }

    /* Base button styles */
  .toolbar .button, .toolbar .btn.btn-secondary {
      cursor: pointer;
      line-height: 10px;
      text-align: center;
      padding: 5px;
      border: 1px solid #404040;
      color: #aaa;
      font-family: Verdana;
      font-size: 10px;
      background: #2a2a2a;
  }

  .toolbar .button:hover, .toolbar .btn.btn-secondary:hover {
      background: #404040 !important;
      border-color: #505050;
      color: #ddd;
  }

  /* Specialized buttons */
  .toolbar .dragbutton {
      float: right;
      padding: 3px 0;
      margin-right: 15px;
      width: 20px;
      -webkit-user-select: none;
      -webkit-app-region: drag;
  }

  .toolbar .copybutton, .toolbar .downloadbutton {
      position: absolute;
      z-index: 10;
      width: calc(100% - 10px);
      margin-top: 5px;
  }

  .toolbar .copybutton {
      display: none;
      bottom: 40px;
  }

  .toolbar .downloadbutton {
      display: inline;
      bottom: 10px;
  }

  /* Container styles */
  .toolbar .container {
      -webkit-user-select: none;
      clear: both;
      padding-top: 5px;
  }

  .modal-container {
      background: #1a1a1a;
  }

  /* Textarea styles */
  .toolbar textarea {
      width: 100%;
      height: 100%;
      max-height: 120px;
      max-width: 170px;
      font-size: 10px;
      font-family: sans-serif;
      background: black;
      color: white;
      border: none;
      outline: none;
      resize: none;
      overflow: auto;
      -webkit-box-shadow: none;
      -moz-box-shadow: none;
      box-shadow: none;
  }

  .toolbar textarea::-webkit-scrollbar {
      display: none;
  }

  /* Checkbox styles */
  .toolbar .checkbox-container {
      display: flex;
      align-items: center;
      position: relative;
      margin: 0 1em;
      cursor: pointer;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      font-size: 10px;
  }

  .toolbar .checkbox-container input {
      position: absolute;
      opacity: 0;
      cursor: pointer;
      height: 0;
      width: 0;
  }

  .toolbar .checkmark {
      height: 15px;
      width: 15px;
      background-color: #eee;
  }

  .toolbar .checkbox-container:hover input ~ .checkmark {
      background-color: #ccc;
  }

  .toolbar .checkbox-container input:checked ~ .checkmark {
      background-color: #2196F3;
  }

  .toolbar .checkbox-container .checkmark:after {
      content: "";
      position: absolute;
      display: none;
      left: 5px;
      right: 3px;
      top: 8px;
      width: 5px;
      height: 10px;
      border: solid white;
      border-width: 0 3px 3px 0;
      transform: rotate(45deg);
      -webkit-transform: rotate(45deg);
      -ms-transform: rotate(45deg);
  }

  .toolbar .checkbox-container input:checked ~ .checkmark:after {
      display: block;
  }

  /* Add disabled states */
  .toolbar .checkbox-container input:disabled ~ .checkmark {
      background-color: #666;
      cursor: not-allowed;
  }

  .toolbar .checkbox-container input:disabled:checked ~ .checkmark {
      background-color: #666;
  }

  .toolbar .checkbox-container:hover input:disabled ~ .checkmark {
      background-color: #666;
  }

  .toolbar .checkbox-label {
    padding-left: 0.75em;
  }
</style>