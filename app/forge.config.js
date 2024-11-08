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
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Peekaview',
        setupExe: 'Peekaview-Setup-${version}.exe',
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
          name: 'Peekaview',
          productName: 'Peekaview',
          dest: 'dist/packages',
          icon: './src/assets/img/peekaview.png',
        },
      },
      platforms: ['linux']
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
      platforms: ['linux']
    },
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
          nodeIntegration: true,
          entryPoints: [{
            name: 'app',
            html: './src/index.html',
            js: './src/app.ts',
            preload: {
              js: './src/preload.ts'
            }
          }, {
            name: 'sources',
            html: './src/sources/index.html',
            js: './src/sources/sources.ts',
            preload: {
              js: './src/sources/preload.ts'
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
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
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

          const filename = `${option.packageJSON.name}-${option.packageJSON.version}-setup${path.extname(artifact)}`
          fs.copyFileSync(artifact, path.join(destDir, filename))
        }
      }
    }
  }
};
