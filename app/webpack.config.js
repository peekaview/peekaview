const path = require('path');
const fs = require('fs');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const { VueLoaderPlugin } = require('vue-loader')
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

const packageJson = require('./package.json')

function getCspPolicy(dev = false) {
  return `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval';
    style-src 'self' 'unsafe-inline';
    connect-src 'self' ${process.env.CONNECT_SRC} ${process.env.API_URL};
    img-src 'self' data:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    block-all-mixed-content;
    upgrade-insecure-requests;
  `.replace(/\s+/g, ' ').trim();
}

module.exports = (env, argv) => {
  const dev = argv.mode === 'development';
  const forWeb = env.WEBPACK_BUNDLE; // true if building for web, false if building for electron  

  const cspPolicy = getCspPolicy(dev)

  const entry = {
    app: './src/app.ts',
  }

  if (!forWeb)
    entry.sources = './src/sources/sources.ts'

  return {
    watch: dev && forWeb,
    mode: argv.mode,
    devServer: forWeb ? undefined : {
      historyApiFallback: true,
      headers: {
        'Content-Security-Policy': cspPolicy,
      },
      static: {
        directory: path.join(__dirname, 'public'),
      },
      port: 8843,
      server: {
        type: 'https',
        options: {
          key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
          cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem')),
        },
      },
      hot: true,
    },
    entry,
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
      filename: `js/[name]${dev ? '' : '.[contenthash]'}.js`,
      assetModuleFilename: 'img/[hash][ext][query]'
    },
    plugins: [
      new webpack.DefinePlugin({
        APP_VERSION: JSON.stringify(packageJson.version),
        WEBPACK_DEVMODE: dev,
        WEBPACK_BUILDTIME: webpack.DefinePlugin.runtimeValue(Date.now, true),

        API_URL: JSON.stringify(process.env.API_URL),

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
        filename: `css/[name]${dev ? '' : '.[contenthash]'}.css`,
      }),
    ],
  };
}