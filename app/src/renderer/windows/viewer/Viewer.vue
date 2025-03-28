<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ViewerData, ViewerDataSchema } from '../../types'
import Viewer from '../../views/viewer/Viewer.vue'
import ViewerForm from '../../views/form/ViewerForm.vue'
import { getStoredItem } from '../../util'
import { ContactData } from '../../../interface'
import { callApi } from '../../api'
import { displayNameMail, parseCode } from '../../../util'

import PeekaViewLogo from '../../../assets/img/peekaviewlogo.png'

const { t } = useI18n()

const formViewerData = ref<ViewerDataSchema>({ emailOrCode: '', name: '' })
const activeViewerData = ref<ViewerData | undefined>()

const contactToNotify = ref<ContactData | undefined>()
window.electronAPI?.onNotifyContact((contact) => {
  contactToNotify.value = contact
})

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('data')
  if (!code)
    throw new Error('')

  const { email, token } = parseCode(code)
  const viewEmail = params.get('viewEmail')
  if (viewEmail)
    formViewerData.value.emailOrCode = viewEmail

  const name = (await getStoredItem('name')) ?? email!
  formViewerData.value.name = name ?? email!

  watch(contactToNotify, (contact) => {
    if (!contact)
      return

    if (email && token) {
      window.electronAPI?.log('Notify contact:', JSON.stringify(contact))
      callApi<Response>({
        action: 'sendPushNotification',
        email: email!,
        token: token!,
        uuid: contact.id,
        notification: JSON.stringify({
          title: 'PeekaView',
          message: t('notifications.viewSharedScreen', { name: displayNameMail({ name, email }) }),
          data: {
            icon: PeekaViewLogo,
            url: new URL(`${import.meta.env.VITE_APP_URL}/?share`).toString(),
            type: 'share',
            email,
          }
        })
      })
    }

    // TODO: can always be assured that a name or an email is available?
    activeViewerData.value = {
      uuid: contact.id,
      name,
    }
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
              auto-submit
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