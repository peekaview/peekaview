import { WindowManager } from "./WindowManager"

export class LinuxWindowManager extends WindowManager {
  constructor(hwnd: string) {
    super(hwnd)
    this.areCoordinatesScaling = true
  }

  getOuterDimensions() {
    const { dimensions } = this.getWindowInfo()

    let windowDimensionsArr = [0, 0, 0, 0];
    if (dimensions.includes(':'))
      windowDimensionsArr = dimensions
        .replace('Absoluteupper-leftX:', '')
        .replace('Absoluteupper-leftY:', '')
        .replace('Width:', '')
        .replace('Height:', '')
        .split('\n')
        .map(n => Number.parseInt(n))

    const left = windowDimensionsArr[0]
    const top = windowDimensionsArr[1]
    const right = left + windowDimensionsArr[2]
    const bottom = top + windowDimensionsArr[3]
    return {
      left,
      top,
      right,
      bottom
    }
  }

  getInnerDimensions() {
    const { dimensions, frame } = this.getWindowInfo()

    let windowDimensionsArr = [0, 0, 0, 0];
    if (dimensions.includes(':'))
      windowDimensionsArr = dimensions
        .replace('Absoluteupper-leftX:', '')
        .replace('Absoluteupper-leftY:', '')
        .replace('Width:', '')
        .replace('Height:', '')
        .split('\n')
        .map(n => Number.parseInt(n))

    let windowFrameArr = [0, 0, 0, 0];
    if (frame.includes('='))
      windowFrameArr = frame
        .split('=')[1]
        .replaceAll(' ', '')
        .replaceAll('\n', '')
        .split(',')
        .map(n => Number.parseInt(n))

    const left = windowDimensionsArr[0] + windowFrameArr[0]
    const top = windowDimensionsArr[1] + windowFrameArr[1]
    const right = left + windowDimensionsArr[2] - windowFrameArr[0] - windowFrameArr[2]
    const bottom = top + windowDimensionsArr[3] - windowFrameArr[1] - windowFrameArr[3]
    return {
      left,
      top,
      right,
      bottom
    };
  }
  
  getWindowInfo(): { dimensions: string, frame: string } {
    throw new Error('Unknown display server')
  }

  isMinimized(): boolean {
    throw new Error('Unknown display server')
  }

  isVisible(): boolean {
    throw new Error('Unknown display server')
  }

  focus() {
    throw new Error('Unknown display server')
  }

  bringToFront() {
    throw new Error('Unknown display server')
  }

  resizeWindow(left: number, top: number, width: number, height: number) {
    throw new Error('Unknown display server')
  }
}
