<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from 'vue'
import { BModal } from 'bootstrap-vue-next'

defineOptions({
  inheritAttrs: true
})

const props = defineProps<{
  show: boolean
}>()

const modalRef = useTemplateRef('modal')

onMounted(() => {
  watch(() => props.show, (show, oldShow) => {
    if (show && !oldShow) {
      modalRef.value!.show()
    } else if (!show && oldShow) {
      modalRef.value!.hide();
    }
  }, { immediate: true })
})

defineSlots<{
  default(): any
  header(): any
  footer(): any
  ok(): any
  cancel(): any
}>()
</script>

<template>
  <BModal ref="modal" tabindex="-1">
    <template #default>
      <slot name="default" />
    </template>
    <template #header>
      <slot name="header" />
    </template>
    <template #footer>
      <slot name="footer" />
    </template>
    <template #ok>
      <slot name="ok" />
    </template>
    <template #cancel>
      <slot name="cancel" />
    </template>
  </BModal>
</template>