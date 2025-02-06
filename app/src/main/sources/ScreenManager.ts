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
    await this.getScreen()
  }

  isScreen() {
    return true
  }

  async getScreen() {
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

  getScreenInfo() {
    return this.screen
  }

  getScaleFactor() {
    return this.screen.scaleFactor
  }

  getOuterDimensions() {
    const screen = this.screen
    return {
      left: screen.bounds.x,
      top: screen.bounds.y,
      right: screen.bounds.x + screen.bounds.width,
      bottom: screen.bounds.y + screen.bounds.height,
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
