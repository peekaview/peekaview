<script setup lang="ts">
import { ComponentPublicInstance, computed, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFloating } from '@floating-ui/vue'

import Login from './views/Login.vue'
import Viewer from './views/viewer/Viewer.vue'
import Presenter from './views/Presenter.vue'
import ViewerForm from './views/form/ViewerForm.vue'
import PresenterForm from './views/form/PresenterForm.vue'
import GDPR from './components/GDPR.vue'
import Imprint from './components/Imprint.vue'

import { useParamsData, Action } from './composables/useParamsData'
import i18n, { type Locale } from './i18n'
import { ViewerData, ViewerDataSchema } from './types'
import { uuidv4, displayNameMail } from '../util'
import { getPushToken, onNotification } from './firebase'
import { callApi } from './api'
import { getStoredItem, setStoredItem, prompt } from './util'
import { ContactData } from '../interface'

import PeekaViewLogo from '../assets/img/peekaviewlogo.png'

const { t } = useI18n()

const showInfo = ref<"imprint" | "gdpr">()
const { action, token, email, target, viewEmail, accessToken } = useParamsData()

const dropdownRef = useTemplateRef('dropdown')
const tagRefs = ref<Record<string, Element | ComponentPublicInstance>>({})

const expandedContactId = ref<string | undefined>()
const expandedTagRef = computed(() => expandedContactId.value ? tagRefs.value[expandedContactId.value] : null)
const { floatingStyles, update: updateFloating } = useFloating(expandedTagRef, dropdownRef, {
  placement: 'top-end',
})
watch(expandedTagRef, (ref) => {
  if (ref)
    updateFloating()
})

const presenterActive = ref(false)
const plannedAction = ref<'view' | 'share'>(action.value === Action.Share ? 'share' : 'view')
const recentContacts = ref<Record<string, ContactData>>({})
const formViewerData = ref<ViewerDataSchema>({ emailOrCode: viewEmail.value ?? '', name: '' })
const activeViewerData = ref<ViewerData | undefined>()
const isViewFixed = computed(() => action.value === Action.View && !!viewEmail.value)
watch(viewEmail, (value) => {
  if (value && !formViewerData.value.emailOrCode)
    formViewerData.value.emailOrCode = value
})

getStoredItem('name').then(value => {
  if (value)
    formViewerData.value.name = value
})

getStoredItem('recentContacts').then(value => {
  if (value)
    recentContacts.value = value
})

const uuidPromise = getStoredItem('uuid')
uuidPromise.then(uuid => {
  if (!uuid) {
    uuid = uuidv4()
    setStoredItem('uuid', uuid)
  }

  console.log('uuid', uuid)

  getPushToken().then(async (token) => {
    await callApi({
      action: 'registerPushToken',
      uuid,
      token,
    })

    onNotification(async (payload) => {
      console.log('notification', payload)
      const result = await prompt({
        text: payload.notification?.body,
        confirmButtonText: t('general.ok'),
        cancelButtonText: t('general.cancel'),
      })

      if (result === '0') {
        switch (payload.data!.type) {
          case 'view':
            activeViewerData.value = {
              name: formViewerData.value!.name,
              email: payload.data!.email,
            }
            break
          case 'share':
            presenterActive.value = true
            break
        }
      }
    })
  }, (error) => {
    console.error('error getting token', error)
  })
})

watch(activeViewerData, (data) => {
  if (!data) {
    document.body.classList.remove('view-active')
    return
  }
  
  document.body.classList.add('view-active')
})

const locale = computed({
  get: () => i18n.global.locale.value,
  set: (value: Locale) => {
    i18n.global.locale.value = value
    localStorage.setItem('locale', value)
  }
})

function expandContact(id: string) {
  if (expandedContactId.value === id)
    expandedContactId.value = undefined
  else
    expandedContactId.value = id
}

function viewRecentContact(id?: string) {
  presenterActive.value = false
  if (!id)
    return

  const contact = recentContacts.value[id]
  if (!contact)
    return

  const name = formViewerData.value.name // todo: name is not updated correctly
  if (!name)
    return

  if (email.value && token.value)
    callApi({
      action: 'sendPushNotification',
      email: email.value,
      token: token.value,
      uuid: contact.id,
      notification: JSON.stringify({
        title: 'PeekaView',
        message: t('notifications.viewSharedScreen', { name }),
        data: {
          icon: PeekaViewLogo,
          url: `${import.meta.env.VITE_APP_URL}/?share`,
          type: 'share',
          email: email.value,
        }
      })
    })

  activeViewerData.value = {
    name,
    email: contact.email!,
  }
}

const contactToNotify = ref<ContactData | undefined>()
function shareRecentContact(id?: string) {
  if (!id || !email.value || !token.value)
    return

  contactToNotify.value = recentContacts.value[id]
  presenterActive.value = true
}
</script>

<template>
  <header v-if="!activeViewerData" class="main-header">
    <a class="header-content" href="/">
      <img :src="PeekaViewLogo" alt="Logo" class="logo">
      <h1 class="header-title">
        <b>SHARE</b> YOUR <b>SCREEN</b>
      </h1>
      <small class="header-subtitle">Simplified & Secure with Peer-to-Peer</small>
    </a>
  </header>

  <div class="main-container" @click="expandedContactId = undefined">
    <Viewer
      v-if="activeViewerData"
      :contact="activeViewerData"
      :access-token="accessToken"
      @stop="activeViewerData = undefined"
    />
    <div v-else class="content-wrapper">
      <div class="section-content">
        <div class="panel">
          <Login
            v-if="action === Action.Login"
            :target="target"
          />
          <Presenter
            v-else-if="presenterActive && email && token"
            :email="email"
            :token="token"
            :contact-to-notify="contactToNotify"
            @stop="presenterActive = false"
          />
          <template v-else>
            <div v-if="!isViewFixed" class="tabs mb-4">
              <div class="tab" :class="{ active: plannedAction === 'view' }" @click="plannedAction = 'view'">
                <div class="p-2">{{ $t('app.form.likeToView') }}</div>
              </div>
              <div class="tab" :class="{ active: plannedAction === 'share' }" @click="plannedAction = 'share'">
                <div class="p-2">{{ $t('app.form.likeToShare') }}</div>
              </div>
            </div>

            <template v-if="plannedAction === 'view'">
              <ViewerForm
                v-model="formViewerData"
                :is-fixed="isViewFixed"
                @submit="activeViewerData = $event"
              />
            </template>

            <template v-else-if="plannedAction === 'share'">
              <PresenterForm
                v-if="email && token"
                :email="email"
                :token="token"
                @present="presenterActive = true"
              />
              <Login v-else target="web" />
            </template>
          </template>
        </div>
        <div v-if="!isViewFixed && Object.keys(recentContacts).length > 0">
          <h6>{{ $t('app.form.recentContacts') }}:</h6>
          <div class="recent-contacts">
            <template v-for="(contact, id) in recentContacts" :key="id">
              <div v-if="contact.email" :ref="(el) => tagRefs[id] = el!" class="pill-tag" :class="{ active: expandedContactId === id }" @click.stop="expandContact(id)">
                <div class="pill-tag-content">
                  <span>{{ displayNameMail(contact) }}</span>
                </div>
              </div>
            </template>
            <div v-show="expandedContactId" ref="dropdown" class="pill-tag-dropdown" :style="floatingStyles" @click.stop="expandedContactId = undefined">
              <a class="dropdown-item" href="#" @click="viewRecentContact(expandedContactId)">{{ $t('app.form.likeToView') }}</a>
              <a class="dropdown-item" href="#" @click="shareRecentContact(expandedContactId)">{{ $t('app.form.likeToShare') }}</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <Imprint v-if="showInfo === 'imprint'" @close="showInfo = undefined"/>
  <GDPR v-if="showInfo === 'gdpr'" @close="showInfo = undefined"/>

  <footer v-if="!activeViewerData" class="main-footer">
    <div class="footer-content">
      <span>
        &copy; 2025 PeekaView | 
        <a href="#" @click="showInfo = 'imprint'">{{ $t('app.imprint') }}</a> | 
        <a href="#" @click="showInfo = 'gdpr'">{{ $t('app.gdpr') }}</a> | 
        <a href="https://github.com/peekaview/peekaview" target="_blank">GitHub</a>
      </span>
      <span>
        <select v-model="locale">
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </span>
    </div>
  </footer>
</template>

<style>
body {
  overflow-x: hidden;
  overflow-y: hidden;
}

body:not(.view-active) {
  background: url('../assets/img/background.jpg') no-repeat center center fixed;
  background-size: cover;
}

body.view-active {
  background: repeating-conic-gradient(#b9b9b9 0% 25%, #acacac 0% 50%) 50% / 20px 20px;
}

#app {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.main-header {
  margin-top: 1rem;
}

.main-footer {
  color: var(--text-color);
  background: var(--panel-bg-color);
  padding: 0.75rem 0;
}

.header-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
  text-decoration: none;
}

.logo-container {
  width: 120px;
}

.logo {
  max-width: 100%;
  height: auto;
  max-height: 70px;
}

.header-title {
  font-size: 1.5rem;
  margin: 0;
  font-weight: 500;
  color: #2c3e50;
}

.header-subtitle {
  margin: 0;
  color: #9d9d9d;
}

.recent-contacts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* Footer Styles */
.main-footer {
  box-shadow: 0 -2px 4px rgba(0,0,0,0.05);
  position: fixed;
  bottom: 0;
  width: 100%;
  border-top: 1px solid rgba(0,0,0,0.05);
}

.footer-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
}

.footer-content span {
  margin: 0;
  font-size: 0.85rem
}

/* Responsive Adjustments */
@media (max-width: 640px) {
  .main-container {
    height: calc(100vh - 125px);
  }
  
  .main-header {
    height: 90px;
  }
  
  .app-container {
    top: 65px;
  }
  
  .header-content {
    padding: 0 1rem;
  }
  
  .header-title {
    font-size: 1.25rem;
  }
  
  .panel {
    padding: 1.5rem;
  }
}
</style>