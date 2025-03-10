<script setup lang="ts">
import { ViewerData } from '../../types'

defineProps<{
  isFixed?: boolean
}>()

defineEmits<{
  (e: 'submit'): void
  (e: 'update:modelValue', { email, name }: ViewerData): void
}>()

const model = defineModel<ViewerData>({ default: { email: '', name: '' } })

function joinDifferentSession() {
  window.location.href = '/?view'
}

function shareOwnScreen() {
  window.location.href = '/?share'
}
</script>

<template>
  <form @submit.prevent="$emit('submit')">
    <div class="form-content">
      <div v-if="isFixed" class="d-flex flex-column mb-4">
        <h4>{{ $t('labels.joinSession') }}</h4>
        <span>{{ model.email }}</span>
      </div>
      <div v-else class="d-flex flex-column mb-4">
        <label for="email" class="form-label">{{ $t('labels.connectToEmail') }}</label>
        <input type="email" class="form-control form-control-lg" name="email"
          v-model="model.email"
          placeholder="example@email.com" required>
      </div>
      <div class="d-flex flex-column mb-4">
        <label for="name" class="form-label">{{ $t('labels.yourName') }}</label>
        <input type="text" class="form-control form-control-lg" name="name"
          v-model="model.name"
          :placeholder="$t('labels.enterYourName')" required>
      </div>
      <button type="submit" class="btn btn-primary btn-lg w-100">{{ $t('viewer.requestAccess') }}</button>
      <template v-if="isFixed">
        <hr>
        <div class="alt-button-row">
          <button class="btn btn-secondary" @click="joinDifferentSession">{{ $t('viewer.joinDifferentSession') }}</button>
          <button class="btn btn-secondary" @click="shareOwnScreen">{{ $t('viewer.shareOwnScreen') }}</button>
        </div>
      </template>
    </div>
  </form>
</template>

<style>
.alt-button-row {
  display: flex;
  gap: 0.5rem;
}

.alt-button-row button {
  font-size: 0.8rem;
  flex: 1;
}
</style>