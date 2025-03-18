<script setup lang="ts">
import { ref, computed, watch } from 'vue'

import ChevronLeftSvg from '../../assets/icons/chevron-left.svg'
import ChevronRightSvg from '../../assets/icons/chevron-right.svg'
import DragSvg from '../../assets/icons/drag.svg'

const props = withDefaults(defineProps<{
  draggable?: boolean
  collapsible?: boolean
  invertCollapseIcons?: boolean
}>(), {
  draggable: false,
  collapsible: false,
  invertCollapseIcons: false
})

const emit = defineEmits<{
  (e: 'onCollapse', collapsed: boolean): void
}>()

const collapsed = ref(false)
const iconCollapsed  = computed(() => (collapsed.value && !props.invertCollapseIcons) || (!collapsed.value && props.invertCollapseIcons))

watch(collapsed, value => emit('onCollapse', value))
watch(() => props.collapsible, flag => !flag && (collapsed.value = false))
</script>

<template>
  <div class="toolbar" :class="{ collapsed }">
    <div v-if="draggable" class="draggable">
      <DragSvg />
    </div>
    <div v-if="collapsible" class="btn btn-sm btn-secondary" :title="$t(`toolbar.${collapsed ? 'expand' : 'collapse'}`)" @click="collapsed = !collapsed">
      <ChevronRightSvg v-if="iconCollapsed" />
      <ChevronLeftSvg v-else />
    </div>
    <template v-if="!collapsed">
      <slot />
    </template>
  </div>
</template>

<style>
  .toolbar {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.5rem;
    font-size: 10px;
    height: 2.25rem;
    user-select: none;
    background: #1a1a1a;
    color: #eee;
    padding: 4px;
    min-width: 0;
    border-radius: 5px;
    border: 1px solid hsla(0, 0%, 25%, 0.75);
    box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.5);
  }

  .toolbar-title {
    font-size: 0.8rem;
    align-self: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toolbar svg {
    fill: #eee;
  }

  .toolbar .btn svg {
    fill: #ccc;
  }

  .toolbar .v-popper .btn {
    max-height: 100%
  }

    /* Base button styles */
  .toolbar .button, .toolbar .btn.btn-secondary {
    cursor: pointer;
    text-align: center;
    padding: 5px;
    font-family: Verdana;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    --bs-btn-color: #aaa;
    --bs-btn-bg: #343434;
    --bs-btn-disabled-bg: #343434;
    --bs-btn-border-color: #444;
    --bs-btn-disabled-border-color: #343434;
    --bs-btn-disabled-opacity: 0.25;
  }

  .toolbar .button.disabled, .toolbar .btn.btn-secondary.disabled {
    pointer-events: auto; 
    cursor: not-allowed;
  }

  .toolbar .button:hover, .toolbar .btn.btn-secondary:hover {
      background: #070707 !important;
      border-color: #565656;
      color: #ddd;
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
      background-color: #666;
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
    white-space: nowrap;
  }

  .toolbar .draggable {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 1.5em;
    -webkit-user-select: none;
    -webkit-app-region: drag;
  }
</style>