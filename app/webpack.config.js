const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const { VueLoaderPlugin } = require('vue-loader')
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

const packageJson = require('./package.json')

module.exports = (env, argv) => {
  const dev = argv.mode === 'development';

  const cspPolicy = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval';
    style-src 'self' 'unsafe-inline';
    connect-src 'self' https://*.meetzi.de wss://*.meetzi.de;
    img-src 'self' data:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    block-all-mixed-content;
    upgrade-insecure-requests;
  `.replace(/\s+/g, ' ').trim();

  return {
    watch: dev,
    mode: argv.mode,
    entry: {
      app: './src/app.ts',
    },
    target: 'web',
    resolve: {
      extensions: ['.ts', '.js', '.vue'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    module: {
      rules: [
        {
          test: /\.vue$/,
          use: ['vue-loader'],
        },
        {
          test: /\.ts$/,
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            appendTsSuffixTo: [/\.vue$/],
          },
          exclude: /node_modules/,
        },
        {
          test: /\.css$/i,
          use: [
            MiniCssExtractPlugin.loader,
            "css-loader"
          ],
        },
        {
          test: /\.(png|jpe?g|gif)$/i,
          type: 'asset/resource'  
        }
      ],
    },
    output: {
      path: path.resolve(__dirname, 'build'),
      filename: 'js/[name].js',
      assetModuleFilename: 'img/[hash][ext][query]'
    },
    plugins: [
      new webpack.DefinePlugin({
        APP_VERSION: JSON.stringify(packageJson.version),
        WEBPACK_DEVMODE: dev,
        WEBPACK_BUILDTIME: webpack.DefinePlugin.runtimeValue(Date.now, true),

        __VUE_OPTIONS_API__: false,
        __VUE_PROD_DEVTOOLS__: false,
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        __VUE_I18N_FULL_INSTALL__: true,
        __VUE_I18N_LEGACY_API__: false,
        __INTLIFY_PROD_DEVTOOLS__: false,
      }),
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'src/index.html'),
        chunks : ['app'],
        meta: {
          'Content-Security-Policy': {
            'http-equiv': 'Content-Security-Policy',
            'content': cspPolicy
          }
        }
      }),
      new VueLoaderPlugin(),
      new ForkTsCheckerWebpackPlugin({
        typescript: {
          extensions: {
            vue: true,
          },
        },
        async: false,
      }),
      new MiniCssExtractPlugin({
        filename: 'css/[name].css',
      }),
    ],
  };
}