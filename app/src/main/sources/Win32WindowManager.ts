import { screen } from 'electron'
import koffi from 'koffi'

import { WindowManager } from "./WindowManager"

// Type for user32 functions
interface User32Functions {
  ShowWindow: (hwnd: number, cmd: number) => boolean;
  IsWindowVisible: (hwnd: number) => boolean;
  IsIconic: (hwnd: number) => boolean;
  SetActiveWindow: (hwnd: number) => number;
  SetForegroundWindow: (hwnd: number) => boolean;
  BringWindowToTop: (hwnd: number) => boolean;
  GetWindowRect: (hwnd: number, rect: Buffer) => boolean;
  GetClientRect: (hwnd: number, rect: Buffer) => boolean;
  ClientToScreen: (hwnd: number, point: Buffer) => boolean;
  SetWindowPos: (hwnd: number, hwndInsertAfter: number, x: number, y: number, width: number, height: number, flags: number) => boolean;
  SetFocus: (hwnd: number) => number;
  GetWindow: (hwnd: number, cmd: number) => number;
  EnumWindows: (lpEnumFunc: any, lParam: any) => boolean;
  GetWindowTextW: (hwnd: number, lpString: Buffer, nMaxCount: number) => boolean;
  GetClassNameW: (hwnd: number, lpString: Buffer, nMaxCount: number) => boolean;
  GetWindowLongA: (hwnd: number, nIndex: number) => number;
  IsZoomed: (hwnd: number) => boolean;
}

export class Win32WindowManager extends WindowManager {
  private user32: User32Functions

  constructor(hwnd: string) {
    super(hwnd)
    this.overlayPadding = {
      x: 20,
      y: 0,
    }

    try {
      const lib = koffi.load('user32.dll');

      this.user32 = {
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
        SetFocus: lib.func('__stdcall', 'SetFocus', 'int64', ['int64']),
        GetWindow: lib.func('__stdcall', 'GetWindow', 'int64', ['int64', 'uint32']),
        EnumWindows: lib.func('__stdcall', 'EnumWindows', 'bool', ['void *', 'void *']),
        GetWindowTextW: lib.func('__stdcall', 'GetWindowTextW', 'bool', ['int64', 'void *', 'int']),
        GetClassNameW: lib.func('__stdcall', 'GetClassNameW', 'bool', ['int64', 'void *', 'int']),
        GetWindowLongA: lib.func('__stdcall', 'GetWindowLongA', 'int64', ['int64', 'int']),
        IsZoomed: lib.func('__stdcall', 'IsZoomed', 'bool', ['int64']),
      }
    } catch (error: any) {
      throw new Error('Windows-specific module (koffi) not available:' + error.message);
    }
  }

  pointerToRect(rectPointer: Buffer) {
    return {
      left: rectPointer.readInt16LE(0),
      top: rectPointer.readInt16LE(4),
      right: rectPointer.readInt16LE(8),
      bottom: rectPointer.readInt16LE(12)
    }
  }
  
  pointerToPoint(pointPointer: Buffer) {
    return {
      x: pointPointer.readInt16LE(0),
      y: pointPointer.readInt16LE(4)
    }
  }

  getScaleFactor() {
    try {
      const rectPointer = Buffer.alloc(16);
      const hwnd = parseInt(this.hwnd);
      
      // Call GetWindowRect with hwnd and rectPointer as separate arguments
      if (!this.user32.GetWindowRect(hwnd, rectPointer)) {
        console.warn('Failed to get window rect');
        return 1;
      }
      
      const windowdimensions = this.pointerToRect(rectPointer);
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

  getOuterDimensions() {
    const rectPointer = Buffer.alloc(16);
    const hwnd = parseInt(this.hwnd);
    
    // Call GetWindowRect with hwnd and rectPointer as separate arguments
    if (!this.user32.GetWindowRect(hwnd, rectPointer))
      throw new Error('Failed to get window rect')
    
    const windowdimensions = this.pointerToRect(rectPointer);
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

    console.log("current screeninfo")
    console.log(screeninfo)
    console.log("current windowdimensions")
    console.log(windowdimensions)
    return windowdimensions;
  }

  getInnerDimensions() {
    const rectPointer = Buffer.alloc(16)
    const pointPointer = Buffer.alloc(16)
    const hwnd = parseInt(this.hwnd)
    const getWindowRect = this.user32.GetClientRect(hwnd, rectPointer)

    if (!getWindowRect)
      throw new Error('Failed to get window rect')
      
    this.user32.ClientToScreen(hwnd, pointPointer)
    const innerDimensions = this.pointerToRect(rectPointer)
    const activeWindowPoint = this.pointerToPoint(pointPointer)
    innerDimensions.left = activeWindowPoint.x + innerDimensions.left
    innerDimensions.top = activeWindowPoint.y + innerDimensions.top
    innerDimensions.right = innerDimensions.left + innerDimensions.right
    innerDimensions.bottom = innerDimensions.top + innerDimensions.bottom
    return innerDimensions
  }

  isMinimized() {
    const hwnd = parseInt(this.hwnd);
    return this.user32.IsIconic(hwnd)
  }

  isVisible() {
    const hwnd = parseInt(this.hwnd);
    if (!this.user32.IsWindowVisible(hwnd)) return false;
    
    // Check for overlap
    return !this.isSignificantlyOverlapped()
  }

  isSignificantlyOverlapped() {
    // Windows constants
    const GW_HWNDPREV = 3;
    const WS_VISIBLE = 0x10000000;
    const WS_POPUP = 0x80000000;
    const WS_CHILD = 0x40000000;
    const WS_MINIMIZE = 0x20000000;
    const WS_DISABLED = 0x8000000;
    const GWL_STYLE = -16;
    const GWL_EXSTYLE = -20;
    const WS_EX_TOOLWINDOW = 0x00000080;
    const WS_EX_NOACTIVATE = 0x08000000;

    const thisRect = this.getOuterDimensions();
    if (!thisRect) return false;

    const thisArea = Math.abs((thisRect.right - thisRect.left) * (thisRect.bottom - thisRect.top));
    let maxOverlapArea = 0;
    
    const processedWindows = new Set();
    const titleBuffer = Buffer.alloc(256);
    
    let hwndCurrent = this.user32.GetWindow(parseInt(this.hwnd), GW_HWNDPREV);
    
    while (hwndCurrent) {
      try {
        if (processedWindows.has(hwndCurrent)) {
          hwndCurrent = this.user32.GetWindow(hwndCurrent, GW_HWNDPREV);
          continue;
        }
        processedWindows.add(hwndCurrent);

        // Get window styles
        const style = this.user32.GetWindowLongA(hwndCurrent, GWL_STYLE);
        const exStyle = this.user32.GetWindowLongA(hwndCurrent, GWL_EXSTYLE);

        // Skip if window is not a normal application window
        if ((style & WS_CHILD) || 
          (style & WS_POPUP) ||
          (style & WS_MINIMIZE) ||
          (style & WS_DISABLED) ||
          !(style & WS_VISIBLE) ||
          (exStyle & WS_EX_TOOLWINDOW) ||
          (exStyle & WS_EX_NOACTIVATE)) {
          hwndCurrent = this.user32.GetWindow(hwndCurrent, GW_HWNDPREV);
          continue;
        }

        // Skip PeekaView windows
        this.user32.GetWindowTextW(hwndCurrent, titleBuffer, 256);
        const windowTitle = titleBuffer.toString('utf16le').split('\0')[0].trim();
        if (windowTitle.startsWith('__peekaview') || 
          windowTitle.startsWith('peekaview - ')) {
          hwndCurrent = this.user32.GetWindow(hwndCurrent, GW_HWNDPREV);
          continue;
        }

        // Get window rect
        const rectPointer = Buffer.alloc(16);
        if (!this.user32.GetWindowRect(hwndCurrent, rectPointer)) {
          hwndCurrent = this.user32.GetWindow(hwndCurrent, GW_HWNDPREV);
          continue;
        }

        const otherRect = this.pointerToRect(rectPointer);

        // Skip invalid windows
        if (!otherRect || 
          otherRect.right <= otherRect.left || 
          otherRect.bottom <= otherRect.top ||
          (otherRect.right - otherRect.left) < 100 ||
          (otherRect.bottom - otherRect.top) < 100) {
          hwndCurrent = this.user32.GetWindow(hwndCurrent, GW_HWNDPREV);
          continue;
        }

        // Calculate overlap
        const xOverlap = Math.max(0, Math.min(thisRect.right, otherRect.right) 
                                    - Math.max(thisRect.left, otherRect.left));
        const yOverlap = Math.max(0, Math.min(thisRect.bottom, otherRect.bottom) 
                                    - Math.max(thisRect.top, otherRect.top));
        
        if (xOverlap > 0 && yOverlap > 0) {
          const overlapArea = Math.abs(xOverlap * yOverlap);
          maxOverlapArea += overlapArea;
        }

      } catch (error) {
          console.warn('Error processing window:', error);
      }
      
      hwndCurrent = this.user32.GetWindow(hwndCurrent, GW_HWNDPREV);
    }

    return (maxOverlapArea / thisArea) * 100 > 5;
  }

  isWindowAbove(otherHwnd: string) {
    let hwnd = parseInt(this.hwnd);
    let currentHwnd = this.user32.GetWindow(hwnd, 3); // GW_HWNDPREV = 3

    while (currentHwnd) {
      if (currentHwnd.toString() === otherHwnd) {
        return true
      }
      currentHwnd = this.user32.GetWindow(currentHwnd, 3);
    }
    return false;
  }

  focus() {
    const hwnd = parseInt(this.hwnd);
    this.user32.SetFocus(hwnd)
    this.user32.SetActiveWindow(hwnd)
    this.user32.BringWindowToTop(hwnd)
  }

  bringToFront() {
    const hwnd = parseInt(this.hwnd)
    this.user32.ShowWindow(hwnd, 9)
    this.user32.SetForegroundWindow(hwnd)
    this.checkIfRectangleUpdated()
    this.user32.SetFocus(hwnd)
    this.user32.SetActiveWindow(hwnd)
    this.user32.BringWindowToTop(hwnd)
  }

  resizeWindow(left: number, top: number, width: number, height: number) {
    const hwnd = parseInt(this.hwnd);
    this.user32.ShowWindow(hwnd, 9)
    this.user32.SetWindowPos(
      hwnd, 
      0, 
      left, 
      top, 
      width, 
      height, 
      0x4000 | 0x0020 | 0x0020 | 0x0040
    )
  }

  hideWindow() {
    const hwnd = parseInt(this.hwnd);
    this.user32.ShowWindow(hwnd, 0)
  }

  showWindow() {
    const hwnd = parseInt(this.hwnd);
    this.user32.ShowWindow(hwnd, 9)
  }
}
