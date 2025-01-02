import Cocoa
import ApplicationServices

guard CommandLine.arguments.count > 1,
      let windowNumber = Int(CommandLine.arguments[1]) else {
    exit(1)
}

let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
let targetWindow = windows.first { window in
    let number = window[kCGWindowNumber as String] as? Int
    return number == windowNumber
}

if let window = targetWindow,
   let ownerPID = window[kCGWindowOwnerPID as String] as? Int32 {
    let workspace = NSWorkspace.shared
    let apps = workspace.runningApplications
    
    if let app = apps.first(where: { $0.processIdentifier == ownerPID }) {
        // First activate the app
        app.activate(options: .activateIgnoringOtherApps)
        
        // Get the accessibility element for the app
        let axApp = AXUIElementCreateApplication(ownerPID)
        var value: AnyObject?
        
        // Get all windows
        if AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &value) == .success,
           let windows = value as? [AXUIElement] {
            
            // Find the specific window by matching window ID
            for axWindow in windows {
                var windowIDRef: CFTypeRef?
                if AXUIElementCopyAttributeValue(axWindow, "_AXWindowID" as CFString, &windowIDRef) == .success,
                   let windowNum = (windowIDRef as? NSNumber)?.intValue,
                   windowNum == windowNumber {
                    
                    // Ensure window is not minimized
                    AXUIElementSetAttributeValue(axWindow, kAXMinimizedAttribute as CFString, false as CFTypeRef)
                    
                    // Raise the window
                    AXUIElementPerformAction(axWindow, kAXRaiseAction as CFString)
                    
                    // Force a window refresh by slightly moving it and back
                    var position = CGPoint.zero
                    var positionRef: AnyObject?
                    if AXUIElementCopyAttributeValue(axWindow, kAXPositionAttribute as CFString, &positionRef) == .success,
                       let posValue = positionRef,
                       CFGetTypeID(posValue) == AXValueGetTypeID() {
                        AXValueGetValue(posValue as! AXValue, .cgPoint, &position)
                        
                        // Move slightly right
                        var newPos = CGPoint(x: position.x + 1, y: position.y)
                        if let moveValue = AXValueCreate(.cgPoint, &newPos) {
                            AXUIElementSetAttributeValue(axWindow, kAXPositionAttribute as CFString, moveValue)
                            
                            // Move back to original position
                            if let originalValue = AXValueCreate(.cgPoint, &position) {
                                AXUIElementSetAttributeValue(axWindow, kAXPositionAttribute as CFString, originalValue)
                            }
                        }
                    }
                    break
                }
            }
        }
    }
}