const fs = require('fs')
const path = require('path')

const { FusesPlugin } = require('@electron-forge/plugin-fuses')
const { FuseV1Options, FuseVersion } = require('@electron/fuses')

module.exports = {
  packagerConfig: {
    out: 'dist',
    executableName: 'peekaview',
    icon: './src/assets/img/peekaview',
    asar: true,
    arch: ['x64', 'arm64'],
<<<<<<< HEAD
    platform: ['darwin'],
    extraResource: ['./src/locales'],
=======
    platform: ['linux'],
>>>>>>> feature/remotedesktop
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'PeekaView',
        setupExe: 'PeekaView-Setup-${version}.exe',
        options: {
          iconUrl: '/peekaview.ico',
          setupIcon: './src/assets/img/peekaview.ico',
        },
      },
      platforms: ['win32']
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'peekaview',
          productName: 'PeekaView',
          dest: 'dist/packages',
          icon: './src/assets/img/peekaview.png',
        },
        mimeType: ["x-scheme-handler/peekaview"],
      },
      platforms: ['linux']
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
      platforms: ['linux']
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        // If any existing DMG config...
      },
      platforms: ['darwin']
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: "./webpack.main.config.js",
        renderer: {
          config: "./webpack.config.js",
          externals: {
            'koffi': 'commonjs koffi',
            '@nut-tree-fork/nut-js': 'commonjs @nut-tree-fork/nut-js',
          },
          nodeIntegration: true,
          entryPoints: [{
            name: 'app',
            html: './src/renderer/app/index.html',
            js: './src/renderer/app/entry.ts',
            preload: {
              js: './src/main/preload/app.ts'
            }
          }, {
            name: 'sources',
            html: './src/renderer/sources/index.html',
            js: './src/renderer/sources/entry.ts',
            preload: {
              js: './src/main/preload/sources.ts'
            }
          }, {
            name: 'login',
            html: './src/renderer/login/index.html',
            js: './src/renderer/login/entry.ts',
            preload: {
              js: './src/main/preload/login.ts'
            }
          }]
        }
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false, // TODO: check how to create integrity validation for macOS and Windows
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    generateAssets: async (_config, platform) => {
      const distPath = path.join('dist', platform)
      if (fs.existsSync(distPath))
        fs.rmSync(distPath, { recursive: true })

      if (fs.existsSync('out'))
        fs.rmSync('out', { recursive: true })

      // Create build directory
      const buildPath = path.join(__dirname, 'build')
      if (!fs.existsSync(buildPath)) {
        fs.mkdirSync(buildPath, { recursive: true })
      }

      // Copy native dependencies to build directory
      /*const dependencies = [
        { src: `node_modules/@nut-tree-fork/libnut-${process.platform}/build/Release/libnut.node`, dest: 'libnut.node' },
        { src: `node_modules/ref-napi/prebuilds/${process.platform}-${process.arch}/ref-napi.node`, dest: 'ref-napi.node' },
        { src: `node_modules/ffi-napi/prebuilds/${process.platform}-${process.arch}/ffi-napi.uv1.node`, dest: 'ffi-napi.node' },
        { src: `node_modules/koffi/build/koffi/${process.platform}_${process.arch}/koffi.node`, dest: 'koffi.node' }
      ];

      dependencies.forEach(({ src, dest }) => {
        const srcPath = path.join(__dirname, src);
        fs.existsSync(srcPath) 
          ? fs.copyFileSync(srcPath, path.join(buildPath, dest))
          : console.warn(`${dest} not found at: ${srcPath}`);
      });*/
    },
    postMake: async (_forgeConfig, options) => {
      if (!fs.existsSync('dist'))
        fs.mkdirSync('dist', { recursive: true })

      for (const option of options) {
        for (const artifact of option.artifacts) {
          const platform = option.platform
          const arch = option.arch
          const destDir = path.join('dist', `${platform}-${arch}`)

          if (!fs.existsSync(destDir))
            fs.mkdirSync(destDir, { recursive: true })

          const filename = `${option.packageJSON.productName}-${option.packageJSON.version}-setup${path.extname(artifact)}`
          fs.copyFileSync(artifact, path.join(destDir, filename))
        }
      }
    }
  }
};
