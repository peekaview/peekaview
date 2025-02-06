import { LinuxWindowManager } from "./LinuxWindowManager"
import { MacWindowManager } from "./MacWindowManager"
import { Win32WindowManager } from "./Win32WindowManager"
import { ScreenManager } from "./ScreenManager"
import { SourceManager } from "./SourceManager"

export function createSourceManager(hwnd: string): SourceManager {
  if (parseInt(hwnd.split(',')[0]) < 10 || (process.platform === 'linux' && parseInt(hwnd) < 10000))
    return new ScreenManager(hwnd)

  switch (process.platform) {
    case 'win32':
      return new Win32WindowManager(hwnd)
    case 'darwin':
      return new MacWindowManager(hwnd)
    case 'linux':
      return new LinuxWindowManager(hwnd)
  }

  throw new Error('Unsupported platform')
}
