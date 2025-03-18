<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ViewerData, ViewerDataSchema } from '../../types'
import Viewer from '../../views/viewer/Viewer.vue'
import ViewerForm from '../../views/form/ViewerForm.vue'
import { getStoredItem } from '../../util'
import { ContactData } from '../../../interface'
import { callApi } from '../../api'
import { parseCode } from '../../../util'

const formViewerData = ref<ViewerDataSchema>({ emailOrCode: '', name: '' })
const activeViewerData = ref<ViewerData | undefined>()

getStoredItem('name').then(value => {
  if (value)
    formViewerData.value.name = value
})

onMounted(() => {
  const code = new URLSearchParams(window.location.search).get('data')
  if (!code)
    throw new Error('')

  const { email, token } = parseCode(code)

  window.electronAPI?.onNotifyContact((contact: ContactData) => {
    if (email && token) {
      window.electronAPI?.log('Notify contact:', contact)
      callApi<Response>({
        action: 'sendPushNotification',
        email: email!,
        token: token!,
        uuid: contact.id,
        title: 'PeekaView',
        message: 'Someone wants to view your screen!',
      })
    }

    if (contact.email)
      formViewerData.value.emailOrCode = contact.email
  })
})
</script>

<template>
  <Viewer
    v-if="activeViewerData"
    :contact="activeViewerData"
    @stop="activeViewerData = undefined"
  />
  <div v-else class="main-container">
    <div class="content-wrapper">
      <div class="section-content">
        <div class="text-center">
          <div class="panel">
            <ViewerForm
              v-model="formViewerData"
              @submit="activeViewerData = $event"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
body {
  background-size: cover;
  background: repeating-conic-gradient(#1a1a1a 0% 25%, #202020 0% 50%) 50% / 20px 20px;
}

#viewer {
  display: flex;
  flex-direction: column;
  align-items: center;
}
</style>