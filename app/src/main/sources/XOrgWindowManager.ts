import { executeCmd, executeCmdCached, resolvePath } from "../util"
import { LinuxWindowManager } from "./LinuxWindowManager"

export class XOrgWindowManager extends LinuxWindowManager {
  constructor(hwnd: string) {
    super(hwnd)
    this.type = "linux_xorg_window"
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

  isMaximized() {
    try {
      const cmd = `
        xprop -id ${this.hwnd} WM_STATE | grep "_NET_WM_STATE(ATOM) || true"
      `
      const windowstate = executeCmdCached(cmd, this.maxCacheAge).toString().replaceAll('\n', '')
      return windowstate.includes('_NET_WM_STATE_MAXIMIZED_VERT') && windowstate.includes('_NET_WM_STATE_MAXIMIZED_HORZ')
    } catch (error) {
      return false
    }
  }

  isMinimized() {
    try {
      const cmd = `
        xprop -id ${this.hwnd} WM_STATE | grep "Iconic" || true
      `
      const windowstate = executeCmdCached(cmd, this.maxCacheAge).toString().replaceAll('\n', '')
      return windowstate.includes('Iconic')
    } catch (error) {
      return false
    }
  }

  isVisible() {
    try {
      const cmd = `
        bash ${resolvePath('static/scripts/windowvisible.sh')} ${this.hwnd}
      `
      const result = executeCmdCached(cmd, this.maxCacheAge).toString().trim()
      return result === '1'
    } catch (error) {
      return true
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
