import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { loadEnv } from 'vite'

import packageJson from './package.json'

const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '')

{[
  "VITE_API_URL",
  "VITE_APP_URL",
  "VITE_CONNECT_SRC",
].map(key => {
  if (!env[key])
    throw new Error(`Required .env variable ${key} is not defined!`)
})}

const CSP_POLICY = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  connect-src 'self' ${env.VITE_CONNECT_SRC} ${env.VITE_API_URL};
  img-src 'self' data:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  block-all-mixed-content;
  upgrade-insecure-requests;
`.replace(/\s+/g, ' ').trim()

const define = {
  APP_VERSION: JSON.stringify(packageJson.version),
  CSP_POLICY: JSON.stringify(CSP_POLICY),
}

export default defineConfig({
  main: {
    build: {
      assetsInlineLimit: 0,
      rollupOptions: {
        input: resolve('src/main/main.ts'),
        output: {
          preserveModules: false
        }
      }
    },
    define,
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          app: resolve('src/preload/app.ts'),
          login: resolve('src/preload/login.ts'),
          sources: resolve('src/preload/sources.ts'),
        },
        output: {
          preserveModules: false
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          app: resolve('src/renderer/index.html'),
          login: resolve('src/renderer/login/index.html'),
          sources: resolve('src/renderer/sources/index.html'),
          remote: resolve('src/renderer/remote/index.html'),
        },
        output: {
          preserveModules: false
        },
        external: [
          'koffi',
          '@nut-tree-fork/nut-js',
        ]
      }
    },
    define,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        "simple-peer": "simple-peer/simplepeer.min.js",
      }
    },
    plugins: [vue()],
    publicDir: resolve('public'),
    server: {
      fs: {
        allow: [
          resolve('static'),
          resolve('src'),
          resolve('.')
        ]
      }
    },
    base: './'
  }
})
