<script setup lang="ts">
import { ref } from 'vue'
import Swal from 'sweetalert2'

import Modal from './components/Modal.vue'
import Viewer from './components/Viewer.vue'
import Share from './components/Share.vue'
import ScreenShare from './components/ScreenShare.vue'

import PeekaviewLogo from './assets/img/peekaviewlogo.png'

import type { ScreenShareData } from './types';
import About from './components/About.vue'

const params = new URLSearchParams(window.location.search)
const action = params.get('action') ?? 'view'
const token = params.get('token') ?? undefined
const email = params.get('email') ?? undefined

const sessionActive = ref(false)
const screenShareData = ref<ScreenShareData>()
const showAbout = ref(false)

async function handleLogout() {
  const result = await Swal.fire({
    title: 'Logout',
    text: 'Are you sure you want to logout?',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Yes, logout',
    cancelButtonText: 'Cancel',
    customClass: {
      popup: 'animate__animated animate__fadeIn'
    }
  })
  
  if (result.isConfirmed)
    window.location.href = 'index.php';
}
</script>

<template>
  <!-- Header -->
  <header class="main-header">
    <div class="header-content">
      <div class="logo-container">
        <img :src="PeekaviewLogo" alt="Logo" class="logo">
      </div>
      <h1 class="header-title">
        <b>Screen Sharing</b>
        <br>
        <small>the simple way</small>
      </h1>
      <div class="header-actions">
        <button v-if="action === 'share' && token" id="logoutBtn" class="btn btn-outline-light" @click="handleLogout">Logout</button>
      </div>
    </div>
  </header>

    <!-- Main Content -->
  <div class="main-container">
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
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- App Container -->
  <div v-if="screenShareData" id="appContainer" class="app-container fade-in">
    <ScreenShare v-bind="screenShareData" />
  </div>

  <Modal :show="!!showAbout" @click="showAbout = false" hide-header hide-footer>
    <About />
  </Modal>

  <footer class="main-footer">
    <div class="footer-content">
      <p>&copy; 2024 Peekaview | <a href="#" @click="showAbout = true">Impressum</a></p>
    </div>
  </footer>
</template>
