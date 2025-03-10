import { XOrgWindowManager } from "./XOrgWindowManager"
import { MacWindowManager } from "./MacWindowManager"
import { Win32WindowManager } from "./Win32WindowManager"
import { ScreenManager } from "./ScreenManager"
import { SourceManager } from "./SourceManager"
import { executeCmd } from "../util"

export function createSourceManager(hwnd: string): SourceManager {
  if (parseInt(hwnd.split(',')[0]) < 10 || (process.platform === 'linux' && parseInt(hwnd) < 10000))
    return new ScreenManager(hwnd)

  switch (process.platform) {
    case 'win32':
      return new Win32WindowManager(hwnd)
    case 'darwin':
      return new MacWindowManager(hwnd)
    case 'linux':
      let displayServer = ''
      try {
        displayServer = executeCmd(`echo $XDG_SESSION_TYPE`).toString().trim()
      }
      catch (e) {
        throw new Error("No display server info available for Linux: " + e)
      }

      if (displayServer === 'x11')
        return new XOrgWindowManager(hwnd)
      
      if (displayServer === 'wayland')
        throw new Error("Wayland display server is not supported. Please use X11 instead.")
      
      throw new Error("Unknown display server for Linux: " + displayServer)
  }

  throw new Error('Unsupported platform')
}
