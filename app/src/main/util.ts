import path from 'path'
import { app } from 'electron'

export function resolvePath(dir: string) {
  return app.isPackaged
    ? path.join(process.resourcesPath, dir)
    : path.join(__dirname, '../../', dir)
}