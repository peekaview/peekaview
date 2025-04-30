import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { loadEnv } from 'vite'
import svgLoader from 'vite-svg-loader'
import { VitePWA } from 'vite-plugin-pwa'

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
          clipboard: resolve('src/preload/clipboard.ts'),
          dialog: resolve('src/preload/dialog.ts'),
          login: resolve('src/preload/login.ts'),
          notifier: resolve('src/preload/notifier.ts'),
          overlay: resolve('src/preload/overlay.ts'),
          presenter: resolve('src/preload/presenter.ts'),
          toolbar: resolve('src/preload/toolbar.ts'),
          viewer: resolve('src/preload/viewer.ts'),
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
          browserPresenter: resolve('src/renderer/browserPresenter/index.html'),
          clipboard: resolve('src/renderer/windows/clipboard/index.html'),
          dialog: resolve('src/renderer/windows/dialog/index.html'),
          login: resolve('src/renderer/windows/login/index.html'),
          notifier: resolve('src/renderer/windows/notifier/index.html'),
          overlay: resolve('src/renderer/windows/overlay/index.html'),
          presenter: resolve('src/renderer/windows/presenter/index.html'),
          toolbar: resolve('src/renderer/windows/toolbar/index.html'),
          viewer: resolve('src/renderer/windows/viewer/index.html'),
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
    plugins: [
      vue(),
      svgLoader(),
      VitePWA({
        strategies: 'injectManifest',
        injectManifest: {
          injectionPoint: undefined
        },
        injectRegister: null,
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: 'index.html'
        },
        srcDir: './',
        workbox: {
          sourcemap: true
        },
        manifest: {
          name: 'PeekaView',
          theme_color: '#ffffff',
        }
      })
    ],
    publicDir: resolve('static'),
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
