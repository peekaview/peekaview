<template>
  <div class="remote-control" id="remoteviewerwrapper">
    <slot></slot>
    <!-- other RemoteControl component content -->
  </div>
</template>

<script setup lang="ts">
import { useRemoteControl } from '../composables/useRemoteControl'

defineExpose({
  ...useRemoteControl()
})
</script>

<style scoped>
.remote-control {
  position: absolute;
  top: 0px;
  left: 0px;
  border: 1px solid #ccc;
  border-radius: 6px;
  overflow: hidden;
}

</style>
