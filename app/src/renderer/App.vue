<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import About from './components/About.vue'
import Login from './components/Login.vue'
import Viewer from './components/Viewer.vue'
import Present from './components/Presenter.vue'

import { prompt } from './util'

import PeekaViewLogo from '../assets/img/peekaviewlogo.png'

enum Action {
  Login = 'login',
  Share = 'share',
  View = 'view'
}

const { t } = useI18n()

const showAbout = ref(false)

const action = ref<Action>(Action.View)
const token = ref<string | undefined>(localStorage.getItem('token') ?? undefined)
const email = ref<string | undefined>(localStorage.getItem('email') ?? undefined)
const name = ref<string | undefined>(localStorage.getItem('name') ?? undefined)
const target = ref<string | undefined>()
const viewEmail = ref<string | undefined>()

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  handleParams(params)

  for (const a of Object.values(Action)) {
    if (!params.has(a))
      continue

    action.value = a
    const value = params.get(a)
    if (value)
      handleParams(new URLSearchParams(atob(value)))

    break
  }
})

function handleParams(params: URLSearchParams) {
  token.value = params.get('token') ?? token.value
  email.value = params.get('email')?.toLowerCase() ?? email.value
  name.value = params.get('name') ?? name.value
  target.value = params.get('target') ?? target.value
  viewEmail.value = params.get('viewEmail')?.toLowerCase() ?? viewEmail.value

  if (params.get('discardSession') === 'true') {
    email.value = undefined
    token.value = undefined
    localStorage.removeItem('email')
    localStorage.removeItem('token')
  }
  
  email.value && localStorage.setItem('email', email.value)
  token.value && localStorage.setItem('token', token.value)
  name.value && localStorage.setItem('name', name.value)
}

async function handleLogout() {
  const result = await prompt({
    title: t("app.logout"),
    text: t("app.confirmLogout"),
    confirmButtonText: t("general.yes"),
    cancelButtonText: t("general.cancel"),
  })
  
  if (result === '0')
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

    <!-- Main Content -->
  <div class="main-container">
    <Login
      v-if="action === 'login'"
      :target="target"
    />
    <Present
      v-else-if="action === 'share' && email && token"
      :email="email"
      :token="token"
    />
    <Viewer
      v-else
      :email="viewEmail"
      :name="name"
    />
  </div>

  <About v-if="showAbout" @click="showAbout = false"/>

  <footer class="main-footer">
    <div class="footer-content">
      <p>&copy; 2024 PeekaView | <a href="#" @click="showAbout = true">{{ $t('app.about') }}</a> | <a href="https://github.com/peekaview/peekaview" target="_blank">GitHub</a></p>
    </div>
  </footer>
</template>

<style>
body {
  background: url('../assets/img/background.jpg') no-repeat center center fixed;
  background-size: cover;
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