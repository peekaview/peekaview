<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Login from './views/Login.vue'
import Viewer from './views/viewer/Viewer.vue'
import Presenter from './views/Presenter.vue'

import GDPR from './components/GDPR.vue'
import Imprint from './components/Imprint.vue'

import { prompt } from './util'

import PeekaViewLogo from '../assets/img/peekaviewlogo.png'
import { useParamsData, Action } from './composables/useParamsData'
import i18n, { type Locale } from './i18n'

const { t } = useI18n()

const showInfo = ref<"imprint" | "gdpr">()
const { action, token, email, name, target, viewEmail } = useParamsData()

const viewActive = ref(false)

watch(viewActive, (viewActive) => {
  if (viewActive)
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
  <header v-if="!viewActive" class="main-header">
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
    <Login
      v-if="action === Action.Login"
      :target="target"
    />
    <Presenter
      v-else-if="action === Action.Share && email && token"
      :email="email"
      :token="token"
    />
    <Viewer
      v-else
      :email="viewEmail"
      :name="name"
      @toggle-full-video="viewActive = $event"
    />
  </div>

  <Imprint v-if="showInfo === 'imprint'" @click="showInfo = undefined"/>
  <GDPR v-if="showInfo === 'gdpr'" @click="showInfo = undefined"/>

  <footer v-if="!viewActive" class="main-footer">
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
  background-size: cover;
}

body:not(.view-active) {
  background: url('../assets/img/background.jpg') no-repeat center center fixed;
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