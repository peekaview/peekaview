<script setup lang="ts">
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useField, useForm } from "vee-validate"
import { toTypedSchema } from "@vee-validate/yup"
import { object, string } from 'yup'

import { ViewerData, ViewerDataSchema } from '../../types'
import { validateEmail, validateCode } from '../../../util'

const props = defineProps<{
  modelValue: ViewerDataSchema
  isFixed?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', data: ViewerDataSchema): void
  (e: 'submit', data: ViewerData): void
}>()

const { t } = useI18n()

const { handleSubmit, values, errors } = useForm<ViewerDataSchema>({
  initialValues: {
    emailOrCode: props.modelValue.emailOrCode || '',
    name: props.modelValue.name || '',
  },
  validationSchema: toTypedSchema(object({
    emailOrCode: string().required(t('general.required')).test('email-or-code', t('viewer.emailOrCodeInvalid'), (value) => !!validateEmail(value) || !!validateCode(value)),
    name: string().required(t('general.required')),
  })),
})
const { value: emailOrCode } = useField('emailOrCode')
const { value: name } = useField('name')

watch(() => props.modelValue.emailOrCode, (value) => emailOrCode.value = value)
watch(() => props.modelValue.name, (value) => name.value = value)
watch(() => values, (value) => emit('update:modelValue', value), { deep: true })

const submit = handleSubmit(async (values) => {
  if (validateEmail(values.emailOrCode)) {
    console.log('submit email', values)
    emit('submit', {
      email: values.emailOrCode,
      name: values.name,
    })
  }
  else if (validateCode(values.emailOrCode)) {
    console.log('submit code', values)
    emit('submit', {
      code: values.emailOrCode,
      name: values.name,
    })
  }
  else {
    throw new Error('Invalid email or code')
  }
})

function joinDifferentSession() {
  window.location.href = '/?view'
}

function shareOwnScreen() {
  window.location.href = '/?share'
}
</script>

<template>
  <form @submit.prevent="submit">
    <div class="form-content">
      <div v-if="isFixed" class="d-flex flex-column mb-4">
        <h4>{{ $t('labels.joinSession') }}</h4>
        <span>{{ emailOrCode }}</span>
      </div>
      <div v-else class="d-flex flex-column mb-4">
        <label for="emailOrCode" class="form-label">{{ $t('labels.connectTo') }}</label>
        <input
          type="text"
          class="form-control form-control-lg"
          name="emailOrCode"
          v-model="emailOrCode"
          :placeholder="`${$t('viewer.exampleMail')} / ${$t('labels.invitationCode')}`" required>
        <span v-if="errors.emailOrCode" class="error">{{ errors.emailOrCode }}</span>
      </div>
      <div class="d-flex flex-column mb-4">
        <label for="name" class="form-label">{{ $t('labels.yourName') }}</label>
        <input
          type="text"
          class="form-control form-control-lg"
          name="name"
          v-model="name"
          :placeholder="$t('labels.enterYourName')" required>
        <span v-if="errors.name" class="error">{{ errors.name }}</span>
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