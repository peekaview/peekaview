const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const { VueLoaderPlugin } = require('vue-loader')
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const { getCspPolicy } = require('./webpack.util.js')

module.exports = (env, argv) => {
  const dev = argv.mode === 'development';
  const forWeb = env.WEBPACK_BUNDLE;
  const cspPolicy = getCspPolicy(dev);

<<<<<<< HEAD
  const cspPolicy = getCspPolicy(dev)

  const entry = {
    app: './src/renderer/app/entry.ts',
  }

  if (!forWeb) {
    entry.sources = './src/renderer/sources/entry.ts'
    entry.login = './src/renderer/login/entry.ts'
  }

  return {
    watch: dev && forWeb,
=======
  const config = {
>>>>>>> feature/remotedesktop
    mode: argv.mode,
    watch: dev && forWeb,
    entry: {
      app: './src/app.ts',
      ...(forWeb ? {} : {
        sources: './src/sources/sources.ts',
        login: './src/login/login.ts'
      })
    },
    target: 'web',
    resolve: {
      extensions: ['.ts', '.js', '.vue'],
      alias: { 
        '@': path.resolve(__dirname, 'src')
      }
    },
    module: {
      rules: [
        { test: /\.vue$/, use: ['vue-loader'] },
        {
          test: /\.ts$/,
          loader: 'ts-loader',
          options: { transpileOnly: true, appendTsSuffixTo: [/\.vue$/] },
          exclude: /node_modules/
        },
        { test: /\.css$/i, use: [MiniCssExtractPlugin.loader, "css-loader"] },
        { test: /\.(png|jpe?g|gif|ico)$/i, type: 'asset/resource' },
        {
          // We're specifying native_modules in the test because the asset relocator loader generates a
          // "fake" .node file which is really a cjs file.
          test: /build[/\\].+\.node$/,
          use: 'node-loader',
        }
      ]
    },
    output: {
      path: path.resolve(__dirname, 'build'),
      filename: `js/[name]${dev ? '' : '.[contenthash]'}.js`,
      assetModuleFilename: 'img/[hash][ext][query]'
    },
    plugins: [
      new webpack.DefinePlugin({
        APP_VERSION: JSON.stringify(require('./package.json').version),
        WEBPACK_DEVMODE: dev,
        WEBPACK_BUILDTIME: webpack.DefinePlugin.runtimeValue(Date.now, true),
        APP_URL: JSON.stringify(process.env.APP_URL),
        API_URL: JSON.stringify(process.env.API_URL),
        __VUE_OPTIONS_API__: false,
        __VUE_PROD_DEVTOOLS__: false,
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        __VUE_I18N_FULL_INSTALL__: true,
        __VUE_I18N_LEGACY_API__: false,
        __INTLIFY_PROD_DEVTOOLS__: false,
      }),
      new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }),
      new HtmlWebpackPlugin({
<<<<<<< HEAD
        template: path.resolve(__dirname, 'src/renderer/app/index.html'),
        chunks : ['app'],
=======
        template: path.resolve(__dirname, 'src/index.html'),
        chunks: ['app'],
>>>>>>> feature/remotedesktop
        meta: {
          'Content-Security-Policy': {
            'http-equiv': 'Content-Security-Policy',
            'content': cspPolicy
          }
        }
      }),
      new VueLoaderPlugin(),
      new ForkTsCheckerWebpackPlugin({
        typescript: { extensions: { vue: true }, async: false }
      }),
      new MiniCssExtractPlugin({
        filename: `css/[name]${dev ? '' : '.[contenthash]'}.css`
      })
    ]
  };

  if (!forWeb && dev) {
    config.devServer = {
      historyApiFallback: true,
      headers: { 'Content-Security-Policy': cspPolicy },
      static: { directory: path.join(__dirname, 'build') },
      port: 8843,
      server: { type: 'https' },
      hot: true
    };
  }

  return config;
};