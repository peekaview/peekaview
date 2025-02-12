import { WindowManager } from "./WindowManager"
import { getStore } from '../store'
import { executeCmd, resolvePath } from '../util'
// import focusWindow from 'mac-focus-window'
// import { getWindows } from 'mac-windows'

export class MacWindowManager extends WindowManager {
  protected currentMonitorProcess: any;
  
  constructor(hwnd: string) {
    super(hwnd)
    this.maxCacheAge = 1000
    this.overlayPadding = {
      x: 20,
      y: 0,
    }
    this.currentMonitorProcess = null
  }

  async onInit() {
    this.startWindowMonitoring()
  }

  async getMacWindowlist() {
    const store = await getStore()
    const windowList = store.get('macWindowList')

    if (windowList?.timestamp >= Date.now() - 3000)
      return windowList.data

    const regex = /\,(?=\s*?[\}\]])/g
    const res = executeCmd(`swift '${resolvePath('static/scripts/mac_windowlist.swift')}'`).toString().replace(regex, '')

    console.log('mac-windowlist', res)

    const processlist = JSON.parse(res.replace(regex, ''))
    console.log(processlist)
    store.set('macWindowList', { timestamp: Date.now(), data: processlist })
    return processlist
  }

  getOuterDimensions() {
    // We can reuse the same function since CGWindow coordinates already include window chrome
    return this.getInnerDimensions()
  }

  getInnerDimensions() {
    try {
        // Read from the temp file instead of executing the Swift script
        const windowInfo = require('fs').readFileSync('/tmp/.peekaview_windowinfo', 'utf8').trim();
        const info = JSON.parse(windowInfo);
        const innerDimensions = {
            left: info.x,
            top: info.y,
            right: info.x + info.width,
            bottom: info.y + info.height
        };
        return innerDimensions;
    } catch (error) {
        console.warn('Error reading window info from temp file:', error);
        const innerDimensions = {
            left: 0,
            top: 0,
            right: 2,
            bottom: 2
        };
        return innerDimensions;
    }
  }

  isMinimized() {
    /* const pid = this.hwnd.split(/,(.*)/s)[0]
    const winname = this.hwnd.split(/,(.*)/s)[1]

    const isvisible = executeCmdCached(`osascript -e 'tell application "System Events" to get description of window "${winname}" of (first process whose id is ${pid})' || true`, this.maxCacheAge).toString().replaceAll('\n', '') */
    return false
    /*
    if (isvisible.toLowerCase().includes('dialog'))
      return true
    return false */
  }

  isVisible() {
    try {
      // Read from the temp file instead of executing the Swift script
      const result = require('fs').readFileSync('/tmp/.peekaview_windowoverlap', 'utf8').trim();
      return result === '1'
    } catch (error) {
      console.warn('Error reading window overlap status from temp file:', error);
      return true // Default to visible if file read fails
    }
  }

  focus() {
    // Write 0 to overlap file to indicate window is overlapped/invalid
    require('fs').writeFileSync('/tmp/.peekaview_windowoverlap', '1');
    // Use Swift script to bring window to front using window number
    executeCmd(`swift ${resolvePath('static/scripts/mac_window_focus.swift')} ${this.hwnd}`)
  }

  bringToFront() {
    // Use Swift script to bring window to front using window number
    executeCmd(`swift ${resolvePath('static/scripts/mac_window_focus.swift')} ${this.hwnd}`)
  }

  startWindowMonitoring() {
    //require('fs').writeFileSync('/tmp/.peekaview_windowoverlap', '0');

    // Kill any existing monitor process
    if (this.currentMonitorProcess) {
      try {
        process.kill(-this.currentMonitorProcess.pid); // Kill process group
      } catch (error) {
        console.warn('Error killing previous monitor process:', error);
      }
      this.currentMonitorProcess = null;
    }

    // Start new monitor process
    this.currentMonitorProcess = require('child_process').spawn('swift', 
      [resolvePath('static/scripts/mac_window_monitor.swift'), this.hwnd], 
      { detached: true }
    );

    // Handle process cleanup
    this.currentMonitorProcess.on('error', (error) => {
      console.warn('Monitor process error:', error);
    });

    this.currentMonitorProcess.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`Monitor process exited with code ${code}`);
        // Write 0 to overlap file to indicate window is overlapped/invalid
        //require('fs').writeFileSync('/tmp/.peekaview_windowoverlap', '1');
      }
      this.currentMonitorProcess = null;
    });
  }

  // Add cleanup method to be called when app is closing
  cleanup() {
    if (this.currentMonitorProcess) {
      try {
        process.kill(-this.currentMonitorProcess.pid);
      } catch (error) {
        console.warn('Error killing monitor process during cleanup:', error);
      }
      this.currentMonitorProcess = null;
    }
  }
}
