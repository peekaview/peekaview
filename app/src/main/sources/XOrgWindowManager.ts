import { executeCmd, executeCmdCached, resolvePath } from "../util"
import { LinuxWindowManager } from "./LinuxWindowManager"

export class XOrgWindowManager extends LinuxWindowManager {
  constructor(hwnd: string) {
    super(hwnd)
  }
  
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
    const cmd = `
      xprop -id ${this.hwnd} WM_STATE | grep "Iconic" || true
    `
    const windowstate = executeCmdCached(cmd, this.maxCacheAge).toString().replaceAll('\n', '')
    return windowstate.includes('Iconic')
  }

  isVisible() {
    try {
      const cmd = `
        bash ${resolvePath('static/scripts/windowvisible.sh')} ${this.hwnd}
      `
      const result = executeCmdCached(cmd, this.maxCacheAge).toString().trim()
      return result === '1'
    } catch (error) {
      return true // Default to visible if script fails
    }
  }

  focus() {
    try {
      const cmd = `
        xdotool windowactivate ${this.hwnd}
      `
      executeCmd(cmd)
    }
    catch (e) { }
  }

  bringToFront() {
    try {
      const cmd = `
        xdotool windowactivate ${this.hwnd}
      `
      executeCmd(cmd)
    }
    catch (e) { }
  }

  resizeWindow(left: number, top: number, width: number, height: number) {
    const cmd = `
      xdotool windowactivate ${this.hwnd} && 
      xdotool windowsize ${this.hwnd} ${width} ${height} && 
      xdotool windowmove ${this.hwnd} ${left} ${top}
    `
    executeCmd(cmd)
  }
}
