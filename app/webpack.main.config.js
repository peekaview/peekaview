const path = require('path');
const webpack = require('webpack');

const packageJson = require('./package.json')
const { getCspPolicy } = require('./webpack.util.js')

module.exports = (env, argv) => {
<<<<<<< HEAD
  const dev = argv.mode === 'development'

  if (!process.env.APP_URL) {
    throw new Error('Environment variable APP_URL must be set')
  }
  if (!process.env.API_URL) {
    throw new Error('Environment variable API_URL must be set')
  }
  if (!process.env.CONNECT_SRC) {
    throw new Error('Environment variable CONNECT_SRC must be set')
  }
=======
  const dev = argv.mode === 'development';
  const staticPath = path.join(__dirname, 'static');
>>>>>>> feature/remotedesktop

  return {
    mode: argv.mode,
    entry: './src/main/main.ts',
    output: {
      path: path.join(__dirname, '.webpack/main'),
      filename: 'index.js'
    },
    target: 'electron-main',
    externals: {
      'koffi': 'commonjs koffi',
      '@nut-tree-fork/nut-js': 'commonjs @nut-tree-fork/nut-js',
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.(png|jpe?g|gif|ico)$/i,
          type: 'asset/resource'
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js']
    },
    plugins: [
      new webpack.DefinePlugin({
        __static: JSON.stringify(staticPath),
        APP_VERSION: JSON.stringify(packageJson.version),
        WEBPACK_DEVMODE: dev,
        WEBPACK_BUILDTIME: webpack.DefinePlugin.runtimeValue(Date.now, true),

        APP_URL: JSON.stringify(process.env.APP_URL),
        API_URL: JSON.stringify(process.env.API_URL),
        CSP_POLICY: JSON.stringify(getCspPolicy(dev)),
      }),
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      })
    ],
  }
}
