<script setup lang="ts">
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm } from "vee-validate"
import { toTypedSchema } from "@vee-validate/yup"
import { object, string } from 'yup'

import { ViewerData } from '../../types'
import { validateEmail, validateCode } from '../../../util'

type ViewerDataSchema = {
  emailOrCode: string
  name: string
}

const props = defineProps<{
  emailOrCode?: string
  name?: string
  isFixed?: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', data: ViewerData): void
}>()

const { t } = useI18n()

const { handleSubmit, setValues } = useForm<ViewerDataSchema>({
  initialValues: {
    emailOrCode: props.emailOrCode || '',
    name: props.name || '',
  },
  validationSchema: toTypedSchema(object({
    emailOrCode: string().required(t('general.required')).test('email-or-code', t('viewer.emailOrCodeInvalid'), (value) => !!validateEmail(value) || !!validateCode(value)),
    name: string().required(t('general.required')),
  })),
})

watch(() => props.emailOrCode, (value) => setValues({ emailOrCode: value }))
watch(() => props.name, (value) => setValues({ name: value }))

const submit = handleSubmit(async (values) => {
  if (validateEmail(values.emailOrCode)) {
    emit('submit', {
      email: values.emailOrCode,
      name: values.name,
    })
  }
  else if (validateCode(values.emailOrCode)) {
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
        <input type="text" class="form-control form-control-lg" name="emailOrCode"
          :placeholder="`${$t('viewer.exampleMail')} / ${$t('labels.invitationCode')}`" required>
      </div>
      <div class="d-flex flex-column mb-4">
        <label for="name" class="form-label">{{ $t('labels.yourName') }}</label>
        <input
          type="text"
          class="form-control form-control-lg"
          name="name"
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