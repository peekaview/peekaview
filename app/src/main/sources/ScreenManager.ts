import { screen } from 'electron'
import { getWindowListFormatted } from "../util"
import { SourceManager } from "./SourceManager"

export class ScreenManager extends SourceManager {
  protected screen: Electron.Display;
  
  constructor(hwnd: string) {
    super(hwnd)
    this.fixOverlayBoundsAfterCreation = (process.platform === 'win32')
    this.screen = screen.getPrimaryDisplay()
  }

  async onInit() {
    const items = await getWindowListFormatted({
      types: ['screen'],
      thumbnailSize: { height: 0, width: 0 },
    })

    let i = 0
    for (const item of items) {
      if (item.id.split(':')[1] === this.hwnd) {
        let j = 0
        for (const cscreen of screen.getAllDisplays()) {
          if (j == i) {
            this.screen = cscreen
          }
          j++
        }
      }
      i++
    }
  }

  isScreen() {
    return true
  }

  getCurrentScreen() {
    return this.screen
  }

  getOuterDimensions() {
    const bounds = this.screen.bounds
    return {
      left: bounds.x,
      top: bounds.y,
      right: bounds.x + bounds.width,
      bottom: bounds.y + bounds.height,
    };
  }

  getInnerDimensions() {
    return {
      left: 0,
      top: 0,
      right: this.screen.size.width,
      bottom: this.screen.size.height,
    }
  }

  isMinimized() {
    return false
  }

  isVisible() {
    return true
  }
}
