<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Login from './views/Login.vue'
import Viewer from './views/viewer/Viewer.vue'
import Presenter from './views/Presenter.vue'
import ViewerForm from './views/form/ViewerForm.vue'
import PresenterForm from './views/form/PresenterForm.vue'
import GDPR from './components/GDPR.vue'
import Imprint from './components/Imprint.vue'

import { prompt } from './util'

import PeekaViewLogo from '../assets/img/peekaviewlogo.png'
import { useParamsData, Action } from './composables/useParamsData'
import i18n, { type Locale } from './i18n'
import { ViewerContact } from './types'

const { t } = useI18n()

const showInfo = ref<"imprint" | "gdpr">()
const { action, token, email, name, target, viewEmail } = useParamsData()

const presenterActive = ref(false)
const plannedAction = ref<'view' | 'share'>(action === Action.Share ? 'share' : 'view')
const lastContacts = ref<ViewerContact[]>([])
const activeViewerContact = ref<ViewerContact | undefined>()

watch(activeViewerContact, (contact) => {
  if (contact)
    document.body.classList.add('view-active')
  else
    document.body.classList.remove('view-active')
})

const locale = computed({
  get: () => i18n.global.locale.value,
  set: (value: Locale) => {
    i18n.global.locale.value = value
    localStorage.setItem('locale', value)
  }
})

async function handleLogout() {
  const result = await prompt({
    title: t("app.logout"),
    text: t("app.confirmLogout"),
    confirmButtonText: t("general.yes"),
    cancelButtonText: t("general.cancel"),
  })
  
  if (result === '0')
    window.location.href = '/'
}
</script>

<template>
  <!-- Header -->
  <header v-if="!activeViewerContact" class="main-header">
    <div class="header-content">
      <div class="logo-container">
        <a href="/">
          <img :src="PeekaViewLogo" alt="Logo" class="logo">
        </a>
      </div>
      <h1 class="header-title">
        <b>SHARE</b>YOUR<b>SCREEN</b>
        <br>
        <small style="color: #9d9d9d;font-size: 1.2rem;">the simple way</small>
      </h1>
      <div class="header-actions">
        <button v-if="action === 'share' && token" class="btn btn-outline-light" @click="handleLogout">
          {{ $t('app.logout') }}
        </button>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <div class="main-container">
    <Viewer
      v-if="activeViewerContact"
      :contact="activeViewerContact"
      @stop="activeViewerContact = undefined"
    />
    <div v-else class="content-wrapper">
      <div class="section-content">
        <div class="text-center">
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
              <div class="form-content">
                <div class="d-flex gap-4 align-items-center">
                  <div>
                    <label class="form-main-label">{{ $t('app.form.iWouldLikeTo') }}</label>
                  </div>
                  <div>
                    <div class="form-check">
                      <label class="form-check-label">
                        <input class="form-check-input" type="radio" v-model="plannedAction" value="view" required >
                        {{ $t('app.form.likeToView') }}
                      </label>
                    </div>
                    <div class="form-check">
                      <label class="form-check-label">
                        <input class="form-check-input" type="radio" v-model="plannedAction" value="share" required >
                        {{ $t('app.form.likeToShare') }}
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <hr>

              <template v-if="plannedAction === 'view'">
                <ViewerForm
                  :model-value="activeViewerContact ?? { email: viewEmail ?? '', name: name ?? '' }"
                  @update:model-value="activeViewerContact = $event"
                />

                <template v-if="lastContacts.length > 0">
                  <hr>
                  <h4>{{ $t('app.form.lastContacts') }}</h4>
                  <div v-for="contact in lastContacts" :key="contact.email">
                    <p>{{ contact.name }} ({{ contact.email }})</p>
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
  </div>

  <Imprint v-if="showInfo === 'imprint'" @click="showInfo = undefined"/>
  <GDPR v-if="showInfo === 'gdpr'" @click="showInfo = undefined"/>

  <footer v-if="!activeViewerContact" class="main-footer">
    <div class="footer-content">
      <p>
        &copy; 2025 PeekaView | 
        <a href="#" @click="showInfo = 'imprint'">{{ $t('app.imprint') }}</a> | 
        <a href="#" @click="showInfo = 'gdpr'">{{ $t('app.gdpr') }}</a> | 
        <a href="https://github.com/peekaview/peekaview" target="_blank">GitHub</a> | 
        <select v-model="locale">
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </p>
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
  background: repeating-conic-gradient(#1a1a1a 0% 25%, #202020 0% 50%) 50% / 20px 20px;
}

.main-header,
.main-footer {
  background: rgba(255, 255, 255, 0.5);
  color: #2c3e50;
  padding: 0.75rem 0;
  backdrop-filter: blur(5px);
}

/* Header Styles */
.main-header {
  height: 90px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
  position: sticky;
  top: 0;
  z-index: 1000;
  border-bottom: 1px solid rgba(0,0,0,0.05);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
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
  text-align: center;
}

.header-actions {
  min-width: 120px;
}

.panel {
  color: #64748b;
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
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
}

.footer-content p {
  margin: 0;
  font-size: 0.9rem;
}

.footer-content a {
  color: #2c3e50;
  text-decoration: none;
}

.footer-content a:hover {
  color: #1a73e8;
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