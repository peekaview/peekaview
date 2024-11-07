<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Swal from 'sweetalert2'

import { callApi } from '../api'

type Response = {
  // TODO: define response
}

const email = ref<string>()
const inElectron = ref<boolean>(!!window.electronAPI)

onMounted(() => {
  if (inElectron) {
    window.open('/?login', '_blank')
  } else {
    // TODO: get cookie data and send per peekaview protocol
  }
})
    
async function handleSubmit(e: Event) {
  e.preventDefault();

  if (!email.value)
    return

  try {
    const data = await callApi<Response>({
      action: 'register',
      email: email.value,
    })
    
    // TODO: handle response
  } catch (error) {
    console.error('Error during registration:', error);
    handleError(error);
  }
}

function handleError(error) {
  Swal.fire({
    icon: 'error',
    title: 'Connection Error',
    text: 'There was a problem connecting to the server. Please try again.',
    customClass: {
        popup: 'animate__animated animate__fadeIn'
    }
  });
}
</script>

<template>
  <div v-if="inElectron" class="text-center">
    <div class="waiting-spinner"></div>
    <h4 class="mt-3" id="waitingMessage">Logge in der Desktop App ein...</h4>
  </div>
  <template v-else>
    <h3 class="text-center mb-4">Register</h3>
    <form id="viewerForm" class="section-form" @submit="handleSubmit">
      <div class="form-content">
        <div class="mb-4">
          <label for="email" class="form-label">Your email address</label>
          <input type="email" class="form-control form-control-lg" id="email" name="email"
            v-model="email"
            placeholder="example@email.com" required>
        </div>
        <button type="submit" class="btn btn-primary btn-lg w-100">Register</button>
      </div>
    </form>
  </template>
</template>