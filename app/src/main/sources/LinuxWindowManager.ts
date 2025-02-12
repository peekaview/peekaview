import { executeCmd, executeCmdCached, resolvePath } from "../util";
import { WindowManager } from "./WindowManager";

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

  // Combine both commands into one to reduce executions
  getWindowInfo() {
    const cmd = `
      xwininfo -id ${this.hwnd} | egrep -e "Absolute upper-left X:|Absolute upper-left Y:|Width:|Height:" && 
      xprop -id ${this.hwnd} | grep FRAME_EXTENTS || true
    `;
    
    const result = executeCmdCached(cmd, this.maxCacheAge).toString();
    const [dimensions, frame] = result.split('FRAME_EXTENTS');
    
    return {
      dimensions: dimensions.replaceAll(' ', ''),
      frame: frame ? frame.toString() : ''
    };
  }

  isMinimized() {
    const windowstate = executeCmdCached(`xprop -id ${this.hwnd} WM_STATE | grep "Iconic" || true`, this.maxCacheAge).toString().replaceAll('\n', '')
    return windowstate.includes('Iconic')
  }

  isVisible() {
    try {
      const result = executeCmdCached(`bash ${resolvePath('static/scripts/windowvisible.sh')} ${this.hwnd}`, this.maxCacheAge).toString().trim()
      return result === '1'
    } catch (error) {
      return true // Default to visible if script fails
    }
  }

  focus() {
    try {
      executeCmd(`xdotool windowactivate ${this.hwnd}`)
    }
    catch (e) { }
  }

  bringToFront() {
    try {
      executeCmd(`xdotool windowactivate ${this.hwnd}`)
    }
    catch (e) { }
  }

  resizeWindow(left: number, top: number, width: number, height: number) {
    executeCmd(`xdotool windowactivate ${this.hwnd} && xdotool windowsize ${this.hwnd} ${width} ${height} && xdotool windowmove ${this.hwnd} ${left} ${top}`)
  }
}
