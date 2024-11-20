const { execSync } = require('child_process');
/*const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FFI_REPO = 'https://github.com/AVVS/node-ffi-napi.git';
const FFI_DIR = path.join(__dirname, 'local_modules', 'node-ffi-napi');

try {
  // Create local_modules directory if it doesn't exist
  const localModulesDir = path.join(__dirname, 'local_modules');
  if (!fs.existsSync(localModulesDir)) {
    fs.mkdirSync(localModulesDir);
  }

  if (!fs.existsSync(FFI_DIR)) {
    console.log('Cloning node-ffi-napi...');
    execSync(`git clone ${FFI_REPO}`, { stdio: 'inherit', cwd: localModulesDir });
  }

  console.log('Installing node-ffi-napi dependencies...');
  process.chdir(FFI_DIR);
  execSync('npm install', { stdio: 'inherit' });
  execSync('npx node-gyp rebuild', { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to install node-ffi-napi:', error.message);
  process.exit(1);
} */

// Add Windows-specific installation
/*if (process.platform === 'win32') {
  console.log('Installing node-ffi-napi for Windows...');
  try {
    execSync('npm install AVVS/node-ffi-napi', { stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to install node-ffi-napi:', error.message);
    process.exit(1);
  }
}*/
