const path = require('path');
const webpack = require('webpack');

const packageJson = require('./package.json')

const { getCspPolicy } = require('./webpack.util.js')

module.exports = (env, argv) => {
  const dev = argv.mode === 'development';

  return {
    mode: argv.mode,
    entry: './src/main.ts',
    output: {
      path: path.join(__dirname, '.webpack/main'),
      filename: 'index.js'
    },
    target: 'electron-main',
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
        APP_VERSION: JSON.stringify(packageJson.version),
        WEBPACK_DEVMODE: dev,
        WEBPACK_BUILDTIME: webpack.DefinePlugin.runtimeValue(Date.now, true),

        APP_URL: JSON.stringify(process.env.APP_URL),
        API_URL: JSON.stringify(process.env.API_URL),
        CSP_POLICY: JSON.stringify(getCspPolicy(dev)),
      }),
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
    ],
  }
}
