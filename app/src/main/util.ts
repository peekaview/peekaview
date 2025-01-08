import path from 'path'
import { app } from 'electron'

export function resolvePath(dir: string) {
  return app.isPackaged
    ? path.join(process.resourcesPath, dir)
    : path.join(__dirname, '../../', dir)
}

// Helper method to generate consistent colors from username
export function generateColorFromName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Convert to hex color, ensuring good contrast and saturation
  return Math.abs(hash).toString(16).substring(0, 6).padEnd(6, 'f')
}