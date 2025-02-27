import { screen } from 'electron'
import { Dimensions, Rectangle, Size } from '../../interface'
import { SourceManager } from './SourceManager'
// import { getActiveWindow } from "@nut-tree/nut-js"

export class WindowManager extends SourceManager {
  protected currentRectangle: Rectangle | undefined;
  protected cropSize: Size;
  protected areCoordinatesScaling: boolean;
  
  constructor(hwnd: string) {
    super(hwnd)
    this.cropSize = {
      width: 0,
      height: 0,
    }
    this.areCoordinatesScaling = false
  }

  checkIfRectangleUpdated() {
    let outerDimensions: Dimensions | null = null
    let innerDimensions: Dimensions | null = null
    try {
      outerDimensions = this.getOuterDimensions()
      innerDimensions = this.getInnerDimensions()
    }
    catch (error) {
      return true
    }

    if (outerDimensions == null || innerDimensions == null)
      return false

    const lastRectangle = this.currentRectangle
    this.currentRectangle = {
      x: innerDimensions.left,
      y: innerDimensions.top,
      width: outerDimensions.right - outerDimensions.left,
      height: outerDimensions.bottom - outerDimensions.top,
    }

    if (!lastRectangle)
      return false

    return this.currentRectangle.x != lastRectangle.x
      || this.currentRectangle.y != lastRectangle.y
      || this.currentRectangle.width != lastRectangle.width
      || this.currentRectangle.height != lastRectangle.height
  }

  getOverlayRectangle() {
    const dimensions = this.getOuterDimensions()
    // Get both screens that the window might span
    const yPoint = (dimensions.top + dimensions.bottom) / 2
    const leftScreen = screen.getDisplayNearestPoint({
      x: dimensions.left,
      y: yPoint
    })
    
    const rightScreen = screen.getDisplayNearestPoint({
      x: dimensions.right,
      y: yPoint
    })

    // Calculate how much of the window is on each screen
    const rawWidth = dimensions.right - dimensions.left
    const rawHeight = dimensions.bottom - dimensions.top

    let scaleFactor

    if (leftScreen.id === rightScreen.id || leftScreen.scaleFactor === rightScreen.scaleFactor) {
      // Window is entirely on one screen
      scaleFactor = leftScreen.scaleFactor
    } else {
      // Window spans two screens - determine which screen contains more of the window
      const splitX = Math.max(leftScreen.bounds.x + leftScreen.bounds.width, dimensions.left)
      const leftPortion = splitX - dimensions.left
      const rightPortion = dimensions.right - splitX
      
      // Calculate percentages
      const leftPercentage = (leftPortion / rawWidth) * 100
      const rightPercentage = (rightPortion / rawWidth) * 100
      
      // Use 60/40 threshold for scale factor selection
      if (leftPercentage >= 60) {
        scaleFactor = leftScreen.scaleFactor
      } else if (rightPercentage >= 60) {
        scaleFactor = rightScreen.scaleFactor
      } else {
        // In the 40-60 range, use the smaller scale factor to ensure overlay is large enough
        scaleFactor = Math.min(leftScreen.scaleFactor, rightScreen.scaleFactor)
      }
      console.log('Left percentage:', leftPercentage)
      console.log('Right percentage:', rightPercentage)
    }

    const maximized = this.isMaximized()

    // Calculate dimensions using the chosen scale factor
    const width = Math.ceil(rawWidth / scaleFactor) - (maximized ? 0 : this.cropSize.width * 2)
    const height = Math.ceil(rawHeight / scaleFactor) - (maximized ? 0 : this.cropSize.height * 2)
    
    const x = Math.round(dimensions.left / (this.areCoordinatesScaling ? scaleFactor : 1)) + (maximized ? 0 : this.cropSize.width)
    const y = Math.round(dimensions.top / (this.areCoordinatesScaling ? scaleFactor : 1)) + (maximized ? 0 : this.cropSize.height)

    console.log('Overlay rectangle:', { x, y, width, height })
    return { x, y, width, height }
  }
}

