<script setup lang="ts">
import { ref, onMounted } from 'vue'
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

const { t } = useI18n()

const sessionActive = ref(false)
const screenShareData = ref<ScreenShareData>()
const showAbout = ref(false)

const action = ref<string>('view')
const token = ref<string | undefined>()
const email = ref<string | undefined>()

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  action.value = params.get('action') ?? 'view'
  const v = params.get('v')
  if (v) {
    const vParams = new URLSearchParams(atob(v))
    action.value = vParams.get('action') ?? 'view'
    token.value = vParams.get('token') ?? localStorage.getItem('token') ?? undefined
    email.value = vParams.get('email')?.toLowerCase() ?? localStorage.getItem('email') ?? undefined
    token.value && localStorage.setItem('token', token.value)
    email.value && localStorage.setItem('email', email.value)
  }
})

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
        <button v-if="action === 'share' && token" id="logoutBtn" class="btn btn-outline-light" @click="handleLogout">
          {{ $t('app.logout') }}
        </button>
      </div>
    </div>
  </header>

  <!-- App Container -->
  <div v-if="screenShareData" id="appContainer" class="app-container fade-in">
    <ScreenShare v-bind="screenShareData" />
  </div>

    <!-- Main Content -->
  <div v-else class="main-container">
    <div class="content-wrapper">
      <div class="content-card">
        <div class="centered-section">
          <div class="section-content">
            <Viewer
              v-if="action === 'view'"
              @start-sharing="screenShareData = $event"
            />
            <Share
              v-else-if="action === 'share' && email && token"
              v-model:session-active="sessionActive"
              :email="email"
              :token="token"
              @start-sharing="screenShareData = $event"
            />
            <Login
              v-else-if="action === 'login'"
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
      <p>&copy; 2024 PeekaView | <a href="#" @click="showAbout = true">{{ $t('app.about') }}</a></p>
    </div>
  </footer>
</template>

<style>

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

/* Form Styles */
.section-form {
  background: rgba(255, 255, 255, 0.98);
  border-radius: 15px;
  padding: 2rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.8);
}

.form-content {
  text-align: left;
}

.form-label {
  font-weight: 500;
  color: #374151;
  margin-bottom: 0.5rem;
}

.form-control-lg {
  padding: 0.75rem 1rem;
  font-size: 1rem;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.1);
  background: rgba(255, 255, 255, 0.9);
  transition: all 0.2s ease;
}

.form-control-lg:focus {
  border-color: #1a73e8;
  box-shadow: 0 0 0 4px rgba(26,115,232,0.1);
  background: #ffffff;
}

.form-control-lg::placeholder {
  color: #9ca3af;
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