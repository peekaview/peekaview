<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import Login from './views/Login.vue'
import Viewer from './views/viewer/Viewer.vue'
import Presenter from './views/Presenter.vue'
import ViewerForm from './views/form/ViewerForm.vue'
import PresenterForm from './views/form/PresenterForm.vue'
import GDPR from './components/GDPR.vue'
import Imprint from './components/Imprint.vue'

import PeekaViewLogo from '../assets/img/peekaviewlogo.png'
import { useParamsData, Action } from './composables/useParamsData'
import i18n, { type Locale } from './i18n'
import { ViewerData } from './types'

const showInfo = ref<"imprint" | "gdpr">()
const { action, token, email, name, target, viewEmail } = useParamsData()

const presenterActive = ref(false)
const plannedAction = ref<'view' | 'share'>(action === Action.Share ? 'share' : 'view')
const recentContacts = ref<string[]>(JSON.parse(localStorage.getItem('recentContacts') ?? '[]'))
const formViewerData = ref<ViewerData>({ email: viewEmail ?? '', name: name ?? '' })
const activeViewerData = ref<ViewerData | undefined>()
const isViewFixed = computed(() => action === Action.View && !!formViewerData.value.email)

watch(activeViewerData, (data) => {
  if (!data) {
    document.body.classList.remove('view-active')
    return
  }
  
  document.body.classList.add('view-active')
  const index = recentContacts.value.findIndex(email => email === data.email)
  let newContacts = recentContacts.value
  if (index >= 0)
    newContacts.splice(index, 1)
  recentContacts.value = [...newContacts, data.email]
})

watch(recentContacts, (value) => {
  localStorage.setItem('recentContacts', JSON.stringify(value))
})

const locale = computed({
  get: () => i18n.global.locale.value,
  set: (value: Locale) => {
    i18n.global.locale.value = value
    localStorage.setItem('locale', value)
  }
})
</script>

<template>
  <header v-if="!activeViewerData" class="main-header">
    <a class="header-content" href="/">
      <img :src="PeekaViewLogo" alt="Logo" class="logo">
      <h1 class="header-title">
        <b>SHARE</b>YOUR<b>SCREEN</b>
      </h1>
      <small class="header-subtitle">Screen Sharing, Simplified & Secure with Peer-to-Peer</small>
    </a>
  </header>

  <div class="main-container">
    <Viewer
      v-if="activeViewerData"
      :contact="activeViewerData"
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
                @submit="activeViewerData = formViewerData"
              />

              <template v-if="!isViewFixed && recentContacts.length > 0">
                <hr>
                <h6>{{ $t('app.form.recentContacts') }}:</h6>
                <div class="recent-contacts">
                  <div v-for="email in recentContacts" :key="email" class="pill-tag" @click="formViewerData.email = email">
                    {{ email }}
                  </div>
                </div>
              </template>
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
      </div>
    </div>
  </div>

  <Imprint v-if="showInfo === 'imprint'" @click="showInfo = undefined"/>
  <GDPR v-if="showInfo === 'gdpr'" @click="showInfo = undefined"/>

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

.main-container {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  max-height: 100%; /* required for viewer video to scale correctly */
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
  font-size: 1.2em;
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
}

.footer-content span {
  margin: 0;
  font-size: 0.85rem
}

.footer-content a {
  color: var(--link-color);
  text-decoration: none;
}

.footer-content a:hover {
  color: var(--text-color);
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