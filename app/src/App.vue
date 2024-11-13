<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Swal from 'sweetalert2'

import About from './components/About.vue'
import Login from './components/Login.vue'
import Modal from './components/Modal.vue'
import Viewer from './components/Viewer.vue'
import Share from './components/Share.vue'
import ScreenShare from './components/ScreenShare.vue'

import PeekaViewLogo from './assets/img/peekaviewlogo.png'

import type { ScreenShareData } from './types'

enum Action {
  Login = 'login',
  Share = 'share',
  View = 'view'
}

const { t } = useI18n()

const screenShareData = ref<ScreenShareData>()
const showAbout = ref(false)

const action = ref<Action>(Action.View)
const token = ref<string | undefined>()
const email = ref<string | undefined>()
const target = ref<string | undefined>()
const viewEmail = ref<string | undefined>()

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  handleParams(params)

  for (const a of Object.values(Action)) {
    const value = params.get(a)
    if (!value)
      continue

    action.value = a
    handleParams(new URLSearchParams(atob(value)))
  }
})

const liveKitDebugUrl = computed(() => 
  `https://meet.livekit.io/custom?liveKitUrl=${screenShareData.value?.serverUrl}&token=${screenShareData.value?.jwtToken}`
)

function handleParams(params: URLSearchParams) {
  email.value = params.get('email')?.toLowerCase() ?? email.value ?? localStorage.getItem('email') ?? undefined
  token.value = params.get('token') ?? token.value ?? localStorage.getItem('token') ?? undefined
  target.value = params.get('target') ?? target.value ?? undefined
  viewEmail.value = params.get('viewEmail')?.toLowerCase() ?? viewEmail.value ?? undefined

  if (params.get('discardSession') === 'true') {
    email.value = undefined
    token.value = undefined
    localStorage.removeItem('email')
    localStorage.removeItem('token')
  }
  
  email.value && localStorage.setItem('email', email.value)
  token.value && localStorage.setItem('token', token.value)
}

async function handleLogout() {
  const result = await Swal.fire({
    title: t("app.logout"),
    text: t("app.confirmLogout"),
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: t("general.yes"),
    cancelButtonText: t("general.cancel"),
    customClass: {
      popup: 'animate__animated animate__fadeIn'
    }
  })
  
  if (result.isConfirmed)
    window.location.href = 'index.php'
}
</script>

<template>
  <!-- Header -->
  <header class="main-header">
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

  <!-- App Container -->
  <div v-if="screenShareData" class="app-container fade-in">
    <ScreenShare v-bind="screenShareData" />
  </div>

    <!-- Main Content -->
  <div v-else class="main-container">
    <div class="content-wrapper">
      <div class="content-card">
        <div class="centered-section">
          <div class="section-content">
            <Login
              v-if="action === 'login'"
              :target="target"
            />
            <Share
              v-else-if="action === 'share' && email && token"
              :email="email"
              :token="token"
              @start-sharing="screenShareData = $event"
            />
            <Viewer
              v-else
              :email="viewEmail"
              @start-sharing="screenShareData = $event"
            />
          </div>
        </div>
      </div>
    </div>
  </div>

  <Modal :show="!!showAbout" @click="showAbout = false" hide-header hide-footer>
    <About />
  </Modal>

  <footer class="main-footer">
    <div class="footer-content">
      <p>&copy; 2024 PeekaView | <a href="#" @click="showAbout = true">{{ $t('app.about') }}</a> | <a href="https://github.com/peekaview/peekaview" target="_blank">GitHub
        <template v-if="screenShareData"> | <a :href="liveKitDebugUrl">Debug LiveKit Room</a></template>
      </a></p>
    </div>
  </footer>
</template>

<style>
body {
  background: url('@/assets/img/background.jpg') no-repeat center center fixed;
  background-size: cover;
}

/* Header Styles */
.main-header {
  background: rgba(255, 255, 255, 0.5);
  color: #2c3e50;
  padding: 0.75rem 0;
  height: 90px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
  position: sticky;
  top: 0;
  z-index: 1000;
  backdrop-filter: blur(5px);
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

/* App Container */
.app-container {
  background: rgba(0,0,0,0.8);
}

/* Content Card */
.content-card {
  background: transparent;
  box-shadow: none;
  border: none;
  backdrop-filter: none;
  padding: 0;
  margin: 0;
}

/* Common Title Styles */
.centered-section h3 {
  color: #998472;
}

/* Main Container Layout */
.main-container {
  height: calc(100vh - 150px);
  padding: 0 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  margin-bottom: 60px;
}

.content-wrapper {
  width: 100%;
  max-width: 600px;
  margin: 2rem auto;
  flex-shrink: 0;
}

/* Centered Section Styles */
.centered-section {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.centered-section h3 {
  text-shadow: #fff 1px 0 10px;
}

.section-content {
  width: 100%;
  max-width: 440px;
  margin: 0 auto;
}

/* Footer Styles */
.main-footer {
  background: rgba(255, 255, 255, 0.5);
  color: #2c3e50;
  padding: 0.75rem 0;
  box-shadow: 0 -2px 4px rgba(0,0,0,0.05);
  position: fixed;
  bottom: 0;
  width: 100%;
  backdrop-filter: blur(5px);
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
  
  .section-form {
    padding: 1.5rem;
  }
}
</style>