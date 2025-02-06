import { screen, BrowserWindow } from 'electron'
import { Dimensions, Point } from '../../interface'

export class SourceManager {
  protected overlaydebug: BrowserWindow | null;
  protected cache: Record<string, {time: number, result: any}>;
  protected hwnd: string;
  protected maxCacheAge: number;
  public fixOverlayBoundsAfterCreation: boolean;

  constructor(hwnd: string) {
    this.overlaydebug = null
    this.cache = {}

    this.hwnd = hwnd

    this.maxCacheAge = 1000
    this.fixOverlayBoundsAfterCreation = false
  }

  async onInit() {}

  isScreen() {
    return false
  }

  getScaleFactor() {
    return 1
  }

  convertDipPosition(mp: Point) {
    const screeninfo = this.getScreenInfo({ x: mp.x, y: mp.y })
    const scaleFactor = this.getScaleFactor()

    return {
      x: Math.round((mp.x - screeninfo.bounds.x) * scaleFactor + screeninfo.bounds.x),
      y: Math.round((mp.y - screeninfo.bounds.y) * scaleFactor + screeninfo.bounds.y)
    }
  }

  getScreenInfo(mp: Point) {
    return screen.getDisplayNearestPoint({ x: mp.x, y: mp.y })
  }

  getOuterDimensions(): Dimensions {
    throw new Error('Unsupported platform')
  }

  getInnerDimensions(): Dimensions {
    throw new Error('Unsupported platform')
  }

  isMinimized(): boolean {
    throw new Error('Unsupported platform')
  }

  isVisible(): boolean {
    throw new Error('Unsupported platform')
  }

  isSignificantlyOverlapped() {
    return false
  }

  isWindowAbove(_otherHwnd: string) {
    throw new Error('Unsupported platform')
  }

  focus() {}

  bringToFront() {}

  checkIfRectangleUpdated() {
    return false
  }

  resizeWindow(_left: number, _top: number, _width: number, _height: number) {
    throw new Error('Unsupported platform')
  }

  hideWindow() {}

  showWindow() {}

  getOverlayRectangle(dimensions: Dimensions) {
    return {
      x: dimensions.left,
      y: dimensions.top,
      width: dimensions.right - dimensions.left,
      height: dimensions.bottom - dimensions.top,
    }
  }
}