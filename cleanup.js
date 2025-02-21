const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  const buildDir = path.join(context.appOutDir, 'resources/app');
  const dirsToRemove = [
    'node_modules/@types',
    'node_modules/.bin',
    'node_modules/.cache'
  ];
  
  dirsToRemove.forEach(dir => {
    const fullPath = path.join(buildDir, dir);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  });
};