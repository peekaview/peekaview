import { screen, desktopCapturer, BrowserWindow } from 'electron'
import { resolvePath } from '../util'
// import { getActiveWindow } from "@nut-tree/nut-js";
// import focusWindow from 'mac-focus-window';
// import { getWindows } from 'mac-windows';

const isWin32 = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'

let user32 = null;
let isUser32Available = false;

if (isWin32) {
  try {
    const koffi = require('koffi');
    
    // Load user32.dll
    const lib = koffi.load('user32.dll');

    // Define Windows API functions using koffi
    user32 = {
      ShowWindow: lib.func('__stdcall', 'ShowWindow', 'bool', ['int64', 'int']),
      IsWindowVisible: lib.func('__stdcall', 'IsWindowVisible', 'bool', ['int64']),
      IsIconic: lib.func('__stdcall', 'IsIconic', 'bool', ['int64']),
      SetActiveWindow: lib.func('__stdcall', 'SetActiveWindow', 'int64', ['int64']),
      SetForegroundWindow: lib.func('__stdcall', 'SetForegroundWindow', 'bool', ['int64']),
      BringWindowToTop: lib.func('__stdcall', 'BringWindowToTop', 'bool', ['int64']),
      GetWindowRect: lib.func('__stdcall', 'GetWindowRect', 'bool', ['int64', 'void *']),
      GetClientRect: lib.func('__stdcall', 'GetClientRect', 'bool', ['int64', 'void *']),
      ClientToScreen: lib.func('__stdcall', 'ClientToScreen', 'bool', ['int64', 'void *']),
      SetWindowPos: lib.func('__stdcall', 'SetWindowPos', 'bool', ['int64', 'int64', 'int', 'int', 'int', 'int', 'uint32']),
      SetFocus: lib.func('__stdcall', 'SetFocus', 'int64', ['int64'])
    };
    isUser32Available = true;
  } catch (error) {
    console.warn('Windows-specific module (koffi) not available:', error.message);
    user32 = null;
    isUser32Available = false;
  }
}

const pointerToRect = function (rectPointer) {
  const rect = {}
  rect.left = rectPointer.readInt16LE(0)
  rect.top = rectPointer.readInt16LE(4)
  rect.right = rectPointer.readInt16LE(8)
  rect.bottom = rectPointer.readInt16LE(12)
  return rect
}

const pointerToPoint = function (pointPointer) {
  const point = {}
  point.x = pointPointer.readInt16LE(0)
  point.y = pointPointer.readInt16LE(4)
  return point
}

export class WindowManager {
  constructor() {
    this.overlayrecord = null
    this.overlayrecordbutton = null
    this.overlaydebug = null
    this.cache = {}

    this.lastmousePosX = 0
    this.lastmousePosY = 0

    this.scalefactor = 1

    this.windowwidth = 0
    this.windowheight = 0
    this.windowleftborder = 0
    this.windowtopborder = 0
    this.windowlist = null
    this.windowlistformatted = null

    // this.title = ''
    // this.window = null
    this.windowhwnd = null
    this.windowprocess = null
    this.electronScreen = screen.getPrimaryDisplay().workAreaSize
    this.electronDisplay = screen.getPrimaryDisplay().size
    this.screen = screen.getPrimaryDisplay()

    this.lastfocus = 0

    // this.overlapping = false
    this.currentMonitorProcess = null;
  }

  selectAndActivateWindow(hwnd) {
    this.selectWindow(`${hwnd}`)
    this.bringToFront()
  }

  async selectWindow(hwnd) {
    this.windowhwnd = `${hwnd}`

    if (this.isScreen()) {
      this.getScreen()
    } else {
      this.startWindowMonitoring();
    }
  }

  isBlacklistedWindow(windowtitle) {
    return windowtitle.startsWith('__peekaview') || windowtitle.trim() == 'peekaview'
  }

  isScreen() {
    if (this.windowhwnd.split(',')[0] < 10 || (isLinux && this.windowhwnd < 10000))
      return true
    else return false
  }

  async getMacWindowlist() {
    const Store = (await import('electron-store')).default
    const store = new Store()
    let res = {}
    let processlist = {}
    if (store.get('windowlist') == undefined || store.get('windowlist').timestamp < Date.now() - 3000) {
      const regex = /\,(?=\s*?[\}\]])/g
      res = this.executeCmd(`swift '${resolvePath('static/scripts/mac_windowlist.swift')}'`).toString().replace(regex, '')

      console.log('mac-windowlist', res)

      processlist = JSON.parse(res.replace(regex, ''))
      console.log(processlist)
      store.set('windowlist', { timestamp: Date.now(), data: processlist })
    }
    else {
      processlist = store.get('windowlist').data
    }
    return processlist
  }

  async getHwndForWindowByTitleAndId(title, id) {
    let windowhwnd = 0
    let num = 0

    console.log("TEST2", isMac)
    // Mac doesn't provide enough information about the windows via desktopCapturer API, so we need our own way to get windows via osascript
    /*if (isMac) {
      const processlist = await this.getMacWindowlist()
      console.log(processlist)


      console.log("TEST")
      processlist.data.forEach((process) => {
        process.windows.forEach((window) => {
          console.log(`${window} - ${title}`)
          if (window.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20) == title.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20)) {
            console.log(`found Mac process (${num},${id}) ${process.id}`)
            this.windowprocess = process.id
            windowhwnd = `${process.id},${window}`
            console.log(`windowhwnd=${windowhwnd}`)
          }
          if (!this.isBlacklistedWindow(window))
            num++
        })
      })
    }
    else {*/
      /*const { desktopCapturer } = require('electron')
      await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { height: 0, width: 0 } })
        .then(async (sources) => {
          for (const source of sources) {
            if (num == id && source.name.replace(/[^a-zA-Z0-9]/g, '') == title.replace(/[^a-zA-Z0-9]/g, '')) {
              console.log(`${id}:${num}:XX: ${source.name} - ${source.id}`)
              windowhwnd = source.id.split(':')[1]
            }
            if (!this.isBlacklistedWindow(source.name))
              num++
          }
        })*/
    //}

    //id = source.id.split(':')[1]

    return id.split(':')[1]
  }

  async selectWindowByTitle(title) {
    const sources = this.getWindowListFormatted({ types: ['screen', 'window'], thumbnailSize: { height: 0, width: 0 } })
    const self = this
    var title = title
    let windowByTitle = null

    await sources.then((items) => {
      items.forEach((item) => {
        console.log(item)
        if (item.name == title) {
          windowByTitle = item.id.split(':')[1]
          console.log(windowByTitle);
          self.windowhwnd = windowByTitle

          return windowByTitle
        }
      })
    }, (error) => { },
    )

    console.log(`SELECT WINDOW: ${windowByTitle}`)
    if (this.isScreen())
      this.getScreen()

    return windowByTitle
  }

  getScreen() {
    console.log(`WINDOWSHWND2 ${this.windowhwnd}`)
    const self = this

    if (this.isScreen()) {
      if (this.windowlistformatted == null) {
        this.windowlistformatted = this.getWindowListFormatted({
          types: ['screen'],
          thumbnailSize: { height: 0, width: 0 },
        })
      }
      const sources = this.windowlistformatted

      sources.then((items) => {
        let i = 0
        items.forEach((item) => {
          if (item.id.split(':')[1] === self.windowhwnd) {
            console.log(`${item.name} - ${item.id}`)
            console.log(`use screen number ${i}`)
            let j = 0
            screen.getAllDisplays().forEach((cscreen) => {
              if (j == i) {
                console.log(`match screen ${j}`)
                console.log(cscreen)
                self.screen = cscreen
              }
              j++
            })
          }
          i++
        })
      }, (error) => { },
      )
    }
  }

  getScaleFactor() {
    if (this.isScreen()) {
      return this.screen.scaleFactor;
    }

    if (isWin32 && isUser32Available && this.windowhwnd) {
      try {
        const rectPointer = Buffer.alloc(16);
        const hwnd = parseInt(this.windowhwnd);
        
        // Call GetWindowRect with hwnd and rectPointer as separate arguments
        if (!user32.GetWindowRect(hwnd, rectPointer)) {
          console.warn('Failed to get window rect');
          return 1;
        }
        
        const windowdimensions = pointerToRect(rectPointer);
        const centerPoint = {
          x: Math.floor((windowdimensions.right + windowdimensions.left) / 2),
          y: Math.floor((windowdimensions.top + windowdimensions.bottom) / 2)
        };
        
        const screeninfoprimary = screen.getPrimaryDisplay();
        const screeninfo = screen.getDisplayNearestPoint(centerPoint);

        return screeninfo.scaleFactor / screeninfoprimary.scaleFactor;
      } catch (error) {
        console.warn('Error getting scale factor:', error);
        return 1;
      }
    }

    return 1; // Default fallback for other platforms
  }

  convertDipPosition(mp) {
    const screeninfo = this.getScreenInfo({ x: mp.x, y: mp.y })
    const scalefactor = this.getScaleFactor()

    let xtranslated = mp.x
    let ytranslated = mp.y

    if (screeninfo.bounds.x >= 0)
      xtranslated = Math.round((mp.x - screeninfo.bounds.x) * scalefactor + screeninfo.bounds.x)

    else
      xtranslated = Math.round(mp.x * scalefactor)

    if (screeninfo.bounds.y >= 0)
      ytranslated = Math.round((mp.y - screeninfo.bounds.y) * scalefactor + screeninfo.bounds.y)

    else
      ytranslated = Math.round(mp.y * scalefactor)

    return { x: xtranslated, y: ytranslated }
  }

  getScreenInfo(mp) {
    let screeninfo
    if (this.isScreen())
      screeninfo = this.screen
    else
      screeninfo = screen.getDisplayNearestPoint({ x: mp.x, y: mp.y })

    return screeninfo
  }

  getWindowOuterDimensions() {
    if (this.isScreen()) {
      const cscreen = this.screen;
      console.log('Screen:')
      console.log(cscreen)
      return {
        left: cscreen.bounds.x,
        top: cscreen.bounds.y,
        right: cscreen.bounds.width + 16,
        bottom: cscreen.bounds.height,
      };
    }

    if (isWin32 && isUser32Available) {
      try {
        const rectPointer = Buffer.alloc(16);
        const hwnd = parseInt(this.windowhwnd);
        
        // Call GetWindowRect with hwnd and rectPointer as separate arguments
        if (!user32.GetWindowRect(hwnd, rectPointer)) {
          console.warn('Failed to get window rect');
          return null;
        }
        
        const windowdimensions = pointerToRect(rectPointer);
        const screeninfo = this.getScreenInfo({
          x: (windowdimensions.right + windowdimensions.left) / 2,
          y: (windowdimensions.top + windowdimensions.bottom) / 2
        });
        const scalefactor = screeninfo.scaleFactor;

        // Remove shadow from dimensions // todo: only if not maximized
        windowdimensions.left = windowdimensions.left + 7;
        windowdimensions.right = windowdimensions.right - 7;
        windowdimensions.bottom = windowdimensions.bottom - 7;

        if (screeninfo.bounds.x >= 0) {
          windowdimensions.left = Math.round((windowdimensions.left - screeninfo.bounds.x) / scalefactor + screeninfo.bounds.x);
          windowdimensions.right = Math.round((windowdimensions.right - screeninfo.bounds.x) / scalefactor + screeninfo.bounds.x);
        } else {
          windowdimensions.left = Math.round(windowdimensions.left / scalefactor);
          windowdimensions.right = Math.round(windowdimensions.right / scalefactor);
        }
        
        if (screeninfo.bounds.y >= 0) {
          windowdimensions.top = Math.round((windowdimensions.top - screeninfo.bounds.y) / scalefactor + screeninfo.bounds.y);
          windowdimensions.bottom = Math.round((windowdimensions.bottom - screeninfo.bounds.y) / scalefactor + screeninfo.bounds.y);
        } else {
          windowdimensions.top = Math.round(windowdimensions.top / scalefactor);
          windowdimensions.bottom = Math.round(windowdimensions.bottom / scalefactor);
        }

        return windowdimensions;
      } catch (error) {
        console.warn('Error getting window dimensions:', error);
        return null;
      }
    }

    if (isLinux) {
      return this.getWindowOuterDimensionsLinux();
    }

    if (isMac) {
      return this.getWindowOuterDimensionsMac();
    }
  }

  getWindowInnerDimensions() {
    if (this.isScreen()) {
      return {
        left: 0,
        top: 0,
        right: this.electronDisplay.width,
        bottom: this.electronDisplay.height,
      }
    }

    if (isWin32) {
      const rectPointer = Buffer.alloc(16)
      const pointPointer = Buffer.alloc(16)
      const hwnd = parseInt(this.windowhwnd);
      const getWindowRect = user32.GetClientRect(hwnd, rectPointer)

      if (!getWindowRect) {
        return null
      }
      else {
        user32.ClientToScreen(hwnd, pointPointer)
        const activeWindowInnerDimensions = pointerToRect(rectPointer)
        const activeWindowPoint = pointerToPoint(pointPointer)
        activeWindowInnerDimensions.left = activeWindowPoint.x + activeWindowInnerDimensions.left
        activeWindowInnerDimensions.top = activeWindowPoint.y + activeWindowInnerDimensions.top
        activeWindowInnerDimensions.right = activeWindowInnerDimensions.left + activeWindowInnerDimensions.right
        activeWindowInnerDimensions.bottom = activeWindowInnerDimensions.top + activeWindowInnerDimensions.bottom
        return activeWindowInnerDimensions
      }
    }

    if (isLinux)
      return this.getWindowInnerDimensionsLinux()

    if (isMac)
      return this.getWindowInnerDimensionsMac()
  }

  // Combine both commands into one to reduce executions
  getWindowInfoLinux() {
    const cmd = `
      xwininfo -id ${this.windowhwnd} | egrep -e "Absolute upper-left X:|Absolute upper-left Y:|Width:|Height:" && 
      xprop -id ${this.windowhwnd} | grep FRAME_EXTENTS || true
    `;
    
    const result = this.executeCmdCached(cmd).toString();
    const [dimensions, frame] = result.split('FRAME_EXTENTS');
    
    return {
      dimensions: dimensions.replaceAll(' ', ''),
      frame: frame ? frame.toString() : ''
    };
  }

  getWindowInnerDimensionsLinux() {
    const { dimensions, frame } = this.getWindowInfoLinux();

    let windowDimensionsArr = [0, 0, 0, 0];
    if (dimensions.includes(':'))
      windowDimensionsArr = dimensions
        .replace('Absoluteupper-leftX:', '')
        .replace('Absoluteupper-leftY:', '')
        .replace('Width:', '')
        .replace('Height:', '')
        .split('\n');

    let windowFrameArr = [0, 0, 0, 0];
    if (frame.includes('='))
      windowFrameArr = frame.split('=')[1].replaceAll(' ', '').replaceAll('\n', '').split(',');

    const activeWindowInnerDimensions = {};
    activeWindowInnerDimensions.left = Number.parseInt(windowDimensionsArr[0]) + Number.parseInt(windowFrameArr[0]);
    activeWindowInnerDimensions.top = Number.parseInt(windowDimensionsArr[1]) + Number.parseInt(windowFrameArr[1]);
    activeWindowInnerDimensions.right = activeWindowInnerDimensions.left + Number.parseInt(windowDimensionsArr[2]) - Number.parseInt(windowFrameArr[0]) - Number.parseInt(windowFrameArr[2]);
    activeWindowInnerDimensions.bottom = activeWindowInnerDimensions.top + Number.parseInt(windowDimensionsArr[3]) - Number.parseInt(windowFrameArr[1]) - Number.parseInt(windowFrameArr[3]);

    return activeWindowInnerDimensions;
  }

  getWindowOuterDimensionsLinux() {
    const { dimensions } = this.getWindowInfoLinux();

    let windowDimensionsArr = [0, 0, 0, 0];
    if (dimensions.includes(':'))
      windowDimensionsArr = dimensions
        .replace('Absoluteupper-leftX:', '')
        .replace('Absoluteupper-leftY:', '')
        .replace('Width:', '')
        .replace('Height:', '')
        .split('\n');

    const activeWindowInnerDimensions = {};
    activeWindowInnerDimensions.left = Number.parseInt(windowDimensionsArr[0]);
    activeWindowInnerDimensions.top = Number.parseInt(windowDimensionsArr[1]);
    activeWindowInnerDimensions.right = activeWindowInnerDimensions.left + Number.parseInt(windowDimensionsArr[2]);
    activeWindowInnerDimensions.bottom = activeWindowInnerDimensions.top + Number.parseInt(windowDimensionsArr[3]);

    return activeWindowInnerDimensions;
  }

  getWindowInnerDimensionsMac() {
    const windowNumber = this.windowhwnd;
    try {
        // Read from the temp file instead of executing the Swift script
        const windowInfo = require('fs').readFileSync('/tmp/.peekaview_windowinfo', 'utf8').trim();
        const info = JSON.parse(windowInfo);
        const activeWindowInnerDimensions = {
            left: info.x,
            top: info.y,
            right: info.x + info.width,
            bottom: info.y + info.height
        };
        return activeWindowInnerDimensions;
    } catch (error) {
        console.warn('Error reading window info from temp file:', error);
        return null;
    }
  }

  getWindowOuterDimensionsMac() {
    // We can reuse the same function since CGWindow coordinates already include window chrome
    return this.getWindowInnerDimensionsMac();
  }

  hideBrowserWindowWhenItAppears(title) {
    let windowcheckinterval = setInterval(() => {
      BrowserWindow.getAllWindows().forEach((item) => {
        if (item.getTitle() === title) {
          console.log(title)
          item.close()
          clearInterval(windowcheckinterval)
          windowcheckinterval = null
        }
      })
    }, 100, title)
  }

  isMinimized() {
    if (this.isScreen())
      return false

    if (isWin32) {
      const hwnd = parseInt(this.windowhwnd);
      return user32.IsIconic(hwnd)
    }

    if (isLinux)
      return this.isMinimizedLinux()

    if (isMac)
      return this.isMinimizedMac()
  }

  isMinimizedLinux() {
    const windowstate = this.executeCmdCached(`xprop -id ${this.windowhwnd} WM_STATE | grep "Iconic" || true`).toString().replaceAll('\n', '')
    return windowstate.includes('Iconic')
  }

  isMinimizedMac() {
    /* const pid = this.windowhwnd.split(/,(.*)/s)[0]
    const winname = this.windowhwnd.split(/,(.*)/s)[1]

    const isvisible = this.executeCmdCached(`osascript -e 'tell application "System Events" to get description of window "${winname}" of (first process whose id is ${pid})' || true`).toString().replaceAll('\n', '') */
    return false
    /*
    if (isvisible.toLowerCase().includes('dialog'))
      return true
    return false */
  }

  isVisible() {
    if (this.isScreen())
      return true
    if (isWin32) {
      const hwnd = parseInt(this.windowhwnd);
      return user32.IsWindowVisible(hwnd)
    }

    if (isLinux) {
      try {
        const result = this.executeCmdCached(`bash ${resolvePath('static/scripts/windowvisible.sh')} ${this.windowhwnd}`).toString().trim()
        return result === '1'
      } catch (error) {
        return true // Default to visible if script fails
      }
    }

    if (isMac) {
      try {
        // Read from the temp file instead of executing the Swift script
        const result = require('fs').readFileSync('/tmp/.peekaview_windowoverlap', 'utf8').trim();
        console.log("overlapstatus: ", result)
        return result === '1'
      } catch (error) {
        console.warn('Error reading window overlap status from temp file:', error);
        return true // Default to visible if file read fails
      }
    }
    
    return true
  }

  focus() {
    if (!this.isScreen()) {
      if (isWin32) {
        const hwnd = parseInt(this.windowhwnd);
        user32.SetFocus(hwnd)
        user32.SetActiveWindow(hwnd)
        user32.BringWindowToTop(hwnd)
      }

      if (isLinux) {
        try {
          this.executeCmd(`xdotool windowactivate ${this.windowhwnd}`)
        }
        catch (e) { }
      }

      if (isMac && this.lastfocus < (Date.now() - 1000)) {
        // Use Swift script to bring window to front using window number
        this.executeCmd(`swift ${resolvePath('static/scripts/mac_window_focus.swift')} ${this.windowhwnd}`)
      }
    }
  }

  bringToFront() {
    if (!this.isScreen()) {
      if (isWin32) {
        const hwnd = parseInt(this.windowhwnd);
        user32.ShowWindow(hwnd, 9)
        user32.SetForegroundWindow(hwnd)
        this.checkWindowSizeAndReposition(hwnd)
        user32.SetFocus(hwnd)
        user32.SetActiveWindow(hwnd)
        user32.BringWindowToTop(hwnd)
      }

      if (isLinux) {
        try {
          this.executeCmd(`xdotool windowactivate ${this.windowhwnd}`)
        }
        catch (e) { }
      }

      if (isMac) {
        // Use Swift script to bring window to front using window number
        this.executeCmd(`swift ${resolvePath('static/scripts/mac_window_focus.swift')} ${this.windowhwnd}`)
      }
    }
  }

  checkIfMouseMoved() {
    const mousePosX = screen.getCursorScreenPoint().x
    const mousePosY = screen.getCursorScreenPoint().y
    if (mousePosX != this.lastmousePosX || mousePosY != this.lastmousePosY) {
      this.lastmousePosX = mousePosX
      this.lastmousePosY = mousePosY
      return true
    }
    else {
      return false
    }
  }

  checkWindowSizeAndReposition() {
    let formatchanged = false
    const sizechanged = false

    if (this.isScreen()) {
      // console.log(this.windowhwnd);
      return false
    }

    // get window dimension
    let activeWindowOuterDimensions = { right: 0, left: 0, bottom: 0, top: 0 }
    let activeWindowInnerDimensions = { right: 0, left: 0, bottom: 0, top: 0 }
    try {
      activeWindowOuterDimensions = this.getWindowOuterDimensions()
      activeWindowInnerDimensions = this.getWindowInnerDimensions()
    }
    catch (error) {
      return true
    }

    if (activeWindowOuterDimensions == null)
      return false

    // get active window width and height
    const activeWindowWidth = activeWindowOuterDimensions.right - activeWindowOuterDimensions.left
    const activeWindowHeight = activeWindowOuterDimensions.bottom - activeWindowOuterDimensions.top

    if (activeWindowInnerDimensions.left != this.windowleftborder || activeWindowInnerDimensions.top != this.windowtopborder)
      formatchanged = true

    if (this.windowwidth != activeWindowWidth || this.windowheight != activeWindowHeight)
      formatchanged = true

    this.windowleftborder = activeWindowInnerDimensions.left
    this.windowtopborder = activeWindowInnerDimensions.top
    this.windowwidth = activeWindowWidth
    this.windowheight = activeWindowHeight

    if (sizechanged) {
      console.log('left: ', activeWindowOuterDimensions.left)
      console.log('top: ', activeWindowOuterDimensions.top)
      console.log('width: ', activeWindowWidth)
      console.log('height: ', activeWindowHeight)
    }

    if (sizechanged) {
      if (isWin32) {
        const hwnd = parseInt(this.windowhwnd);
        user32.ShowWindow(hwnd, 9)
        user32.SetWindowPos([
          hwnd, 
          0, 
          activeWindowOuterDimensions.left, 
          activeWindowOuterDimensions.top, 
          activeWindowWidth, 
          activeWindowHeight, 
          0x4000 | 0x0020 | 0x0020 | 0x0040
        ])

        formatchanged = true
      }
      if (isLinux) {
        this.executeCmd(`xdotool windowactivate ${this.windowhwnd} && xdotool windowsize ${this.windowhwnd} ${activeWindowWidth} ${activeWindowHeight} && xdotool windowmove ${this.windowhwnd} ${activeWindowOuterDimensions.left} ${activeWindowOuterDimensions.top}`)
      }
    }

    return formatchanged
  }

  resizeWindow(left, top, width, height) {
    if (isWin32) {
      const hwnd = parseInt(this.windowhwnd);
      user32.ShowWindow(hwnd, 9)
      user32.SetWindowPos([
        hwnd, 
        0, 
        left, 
        top, 
        width, 
        height, 
        0x4000 | 0x0020 | 0x0020 | 0x0040
      ])
    }
    if (isLinux) {
      this.executeCmd(`xdotool windowactivate ${this.windowhwnd} && xdotool windowsize ${this.windowhwnd} ${width} ${height} && xdotool windowmove ${this.windowhwnd} ${left} ${top}`)
    }
  }

  hideWindow() {
    if (isWin32) {
      const hwnd = parseInt(this.windowhwnd);
      user32.ShowWindow(hwnd, 0)
    }
  }

  showWindow() {
    if (isWin32) {
      const hwnd = parseInt(this.windowhwnd);
      user32.ShowWindow(hwnd, 9)
    }
  }

  executeCmdCached(cmd) {
    const maxcacheage = isMac ? 1000 : 1000
    const cacheKey = cmd.replace(/[^a-zA-Z0-9]/g, '')

    if (this.cache[cacheKey] === undefined)
      this.cache[cacheKey] = { time: 0, result: null }

    if (this.cache[cacheKey].time < (Date.now() - maxcacheage) || this.cache[cacheKey].result == null) {
      //console.log(cmd)
      this.cache[cacheKey] = { time: Date.now(), result: require('child_process').execSync(cmd) }
    }

    return this.cache[cacheKey].result
  }

  executeCmd(cmd) {
    //console.log(cmd)
    return require('child_process').execSync(cmd)
  }

  executeCmdAsync(cmd) {
    return new Promise((resolve, reject) => {
      require('child_process').exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.warn(`Error executing command: ${error}`);
          reject(error);
          return;
        }
        resolve(stdout);
      });
    });
  }

  getWindowListFormatted(options) {
    return new Promise((resolve, reject) => {
      desktopCapturer.getSources(options).then((sources) => {
        return resolve(
          sources.map((source) => {
            return {
              id: source.id,
              name: source.name,
              url: source.thumbnail.toDataURL(),
            }
          }),
        )
      })
    })
  }

  async getWindowList() {
    // var promise = Promise.resolve();
    const self = this
    const windowlist = []

    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { height: 0, width: 0 } })
    for (const s in sources) {
      if (!this.isBlacklistedWindow(sources[s].name)) {
        const hwnd = sources[s].id.split(':')[1]
        windowlist.push(hwnd)
      }
    }
    

    self.windowlist = windowlist
    // console.log(windowlist);
    return windowlist
  }

  isRecordOverlayClosed() {
    return this.overlayrecord == null
  }

  closeRecordOverlay() {
    if (this.overlayrecord != null) {
      this.overlayrecord.close()
      this.overlayrecord = null
    }
  }

  hideRecordOverlay() {
    if (this.overlayrecord != null) {
      this.overlayrecord.close()
      this.overlayrecord = null
    }
  }


  showDebugOverlay(args) {
    if (this.overlaydebug == null) {
      this.overlaydebug = new BrowserWindow({
        x: 0,
        y: 0,
        width: 1280,
        height: 1000,
        transparent: false,
        skipTaskbar: true,
        title: 'Debug',
        webPreferences: {
          nodeIntegration: true,
        },
      })

      // Set CSP headers before loading the URL
      this.overlaydebug.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': ["frame-ancestors 'self' file:;"]
          }
        });
      });

      const queryString = new URLSearchParams(args).toString();
      const filePath = resolvePath('static/sharewindow.html');
      this.overlaydebug.loadURL(`file://${filePath}?${queryString}`);

      // Open DevTools automatically
      //this.overlaydebug.webContents.openDevTools();
    }
  }


  showRecordOverlay() {
    if (!this.isScreen()) {
      const windowdimensions = this.getWindowOuterDimensions()

      const x = windowdimensions.left - 2
      const y = windowdimensions.top - 2
      const width = windowdimensions.right - windowdimensions.left + 20
      const height = windowdimensions.bottom - windowdimensions.top + 4
      const scalefactor = this.getScaleFactor()

      console.log(scalefactor)

      this.overlayrecord = new BrowserWindow({
        x,
        y,
        width: Math.round(width / scalefactor),
        height: Math.round(height / scalefactor),
        transparent: true,
        skipTaskbar: true,
        focusable: false,
        roundedCorners: false,
        enableLargerThanScreen: true,
        title: '__peekaview - WindowCapture',
        frame: false,
        alwaysOnTop: true,
        webPreferences: {
          nodeIntegration: true,
        },
      })

      console.log('Overlay:')
      console.log(windowdimensions)

      this.overlayrecord.removeMenu()
      this.overlayrecord.loadFile(resolvePath('static/windowoverlay.html'))
      this.overlayrecord.setIgnoreMouseEvents(true)


      //this.overlayrecord.webContents.openDevTools();
    } else {
      const windowdimensions = this.getWindowOuterDimensions()

      this.overlayrecord = new BrowserWindow({
        x: windowdimensions.left,
        y: windowdimensions.top,
        width: windowdimensions.right - windowdimensions.left,
        height: windowdimensions.bottom - windowdimensions.top,
        transparent: true,
        skipTaskbar: true,
        focusable: false,
        roundedCorners: false,
        enableLargerThanScreen: true,
        title: '__peekaview - WindowCapture',
        frame: false,
        alwaysOnTop: true,
        webPreferences: {
          nodeIntegration: true,
        },
      })

      this.overlayrecord.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.overlayrecord.setAlwaysOnTop(true, 'screen-saver', 1);

      this.overlayrecord.removeMenu()
      this.overlayrecord.loadFile(resolvePath('static/windowoverlay.html'))
      this.overlayrecord.setIgnoreMouseEvents(true)
    }
  }

  /*
  removeTitleBar() {
    if (isWin32) {
      const WS_BORDER = 8388608
      const WS_DLGFRAME = 4194304
      const WS_CAPTION = WS_BORDER | WS_DLGFRAME
      const WS_SYSMENU = 524288
      const WS_THICKFRAME = 262144
      const WS_MINIMIZE = 536870912
      const WS_MAXIMIZEBOX = 65536
      const WS_POPUP = 0x8
      const GWL_STYLE = -16
      // const GWL_EXSTYLE = -20;
      const WS_EX_DLGMODALFRAME = 0x1
      const SWP_NOMOVE = 0x2
      const SWP_NOSIZE = 0x1
      const SWP_FRAMECHANGED = 0x20
      const MF_BYPOSITION = 0x400
      const MF_REMOVE = 0x1000
      const SW_HIDE = 0x00
      const SW_SHOW = 0x05

      const WS_EX_APPWINDOW = 0x40000
      const GWL_EXSTYLE = -0x14
      const WS_EX_TOOLWINDOW = 0x0080

      let style = user32.GetWindowLongW(this.windowhwnd, GWL_STYLE)
      style = style & ~WS_CAPTION
      style = style & ~WS_SYSMENU
      style = style & ~WS_THICKFRAME
      // style = style & (~WS_MINIMIZE);
      // style = style & (~WS_MAXIMIZEBOX);
      user32.SetWindowLongW(this.windowhwnd, GWL_STYLE, style)

      user32.ShowWindow(this.windowhwnd, SW_HIDE)
      user32.SetWindowLongW(
        this.windowhwnd,
        GWL_EXSTYLE,
        user32.GetWindowLongW(this.windowhwnd, GWL_EXSTYLE) | WS_EX_TOOLWINDOW,
      )
      user32.ShowWindow(this.windowhwnd, SW_SHOW)
    }
    if (isLinux) {
      const removeTitlebar = require('child_process') .execSync( `xprop -id ${this.windowhwnd} -f _MOTIF_WM_HINTS 32c -set _MOTIF_WM_HINTS "0x2, 0x0, 0x0, 0x0, 0x0" || true`, ) .toString() .replaceAll('\n', '')
      const removeFromTaskbar = require('child_process') .execSync( `xprop -id ${this.windowhwnd} -f _NET_WM_STATE 32a -set _NET_WM_STATE _NET_WM_STATE_SKIP_TASKBAR || true`, ) .toString() .replaceAll('\n', '')
    }
  }

  isOverlapping() {
    if (this.isScreen())
      return false

    // check window arrangement
    const sources = this.getWindowListFormatted({
      types: ['window'],
      thumbnailSize: { height: 0, width: 0 },
    })

    const self = this
    let overlapping = false
    // let windowpos = 0;

    const rect1 = this.getWindowOuterDimensions()

    sources.then(
      (items) => {
        items.forEach((item) => {
          const hwnd = item.id.split(':')[1]

          if (hwnd != self.windowhwnd && !item.name.startsWith('__meetzi')) {
            const tmpWindowManager = new WindowManager()
            tmpWindowManager.selectWindow(hwnd)
            if (
              tmpWindowManager.isVisible()
              && !tmpWindowManager.isMinimized()
            ) {
              const rect2 = tmpWindowManager.getWindowOuterDimensions()

              const x_overlap = Math.max(
                0,
                Math.min(rect1.right, rect2.right)
                - Math.max(rect1.left, rect2.left),
              )
              const y_overlap = Math.max(
                0,
                Math.min(rect1.bottom, rect2.bottom)
                - Math.max(rect1.top, rect2.top),
              )
              const overlapArea = x_overlap * y_overlap

              // console.log("overlap: " + item.name + ":" + overlapArea);
              if (overlapArea > 0)
                overlapping = true
            }
          }
          if (hwnd == self.windowhwnd && overlapping) {
            // console.log("found: " + item.name + ":");
            self.overlapping = true

            return true
          }
          if (hwnd == self.windowhwnd && !overlapping) {
            self.overlapping = false
            return false
          }
        })
      },
      (error) => { },
    )

    return this.overlapping
  } */

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

  startWindowMonitoring() {
    if (!isMac) return;

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
      [resolvePath('static/scripts/mac_window_monitor.swift'), this.windowhwnd], 
      { detached: true }
    );

    // Handle process cleanup
    this.currentMonitorProcess.on('error', (error) => {
      console.warn('Monitor process error:', error);
    });

    this.currentMonitorProcess.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`Monitor process exited with code ${code}`);
      }
      this.currentMonitorProcess = null;
    });
  }
}