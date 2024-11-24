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
#remoteviewerwrapper {
  position: absolute;
  top: 0px;
  left: 0px;
}

</style>
