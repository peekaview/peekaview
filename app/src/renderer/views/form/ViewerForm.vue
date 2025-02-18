<script setup lang="ts">
import { ViewerData } from '../../types'

const props = defineProps<{
  isEmailFixed?: boolean
}>()

console.log('isEmailFixed', props.isEmailFixed)

defineEmits<{
  (e: 'submit'): void
  (e: 'update:modelValue', { email, name }: ViewerData): void
}>()

const model = defineModel<ViewerData>({ default: { email: '', name: '' } })
</script>

<template>
  <form @submit.prevent="$emit('submit')">
    <div class="form-content">
      <div class="mb-4">
        <label for="email" class="form-label">{{ $t('labels.connectToEmail') }}</label>
        <input v-if="!isEmailFixed" type="email" class="form-control form-control-lg" name="email"
          v-model="model.email"
          placeholder="example@email.com" required>
        <span v-else>{{ model.email }}</span>
      </div>
      <div class="mb-4">
        <label for="name" class="form-label">{{ $t('labels.yourName') }}</label>
        <input type="text" class="form-control form-control-lg" name="name"
          v-model="model.name"
          :placeholder="$t('labels.enterYourName')" required>
      </div>
      <button type="submit" class="btn btn-primary btn-lg w-100">{{ $t('viewer.requestAccess') }}</button>
    </div>
  </form>
</template>