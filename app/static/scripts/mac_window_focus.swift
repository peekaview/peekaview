import Cocoa
import ApplicationServices

guard CommandLine.arguments.count > 1,
      let windowNumber = Int(CommandLine.arguments[1]) else {
    print("Error: No window number provided")
    exit(1)
}

print("Looking for window ID: \(windowNumber)")

let windowOverlapPath = "/tmp/.peekaview_windowoverlap"

let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
let targetWindow = windows.first { window in
    let number = window[kCGWindowNumber as String] as? Int
    return number == windowNumber
}

if let window = targetWindow,
   let ownerPID = window[kCGWindowOwnerPID as String] as? Int32,
   let windowTitle = window[kCGWindowName as String] as? String {
    
    print("Found window:")
    print("  Title: \(windowTitle)")
    print("  PID: \(ownerPID)")
    print("  Window ID: \(windowNumber)")
    
    let workspace = NSWorkspace.shared
    let apps = workspace.runningApplications
    
    if let app = apps.first(where: { $0.processIdentifier == ownerPID }) {
        print("Found application: \(app.localizedName ?? "Unknown")")
        
        // First activate the app
        if #available(macOS 14.0, *) {
            app.activate()
        } else {
            app.activate(options: .activateIgnoringOtherApps)
        }
        
        usleep(50000) // 50ms delay
        
        let axApp = AXUIElementCreateApplication(ownerPID)
        var windowsRef: CFTypeRef?
        
        print("Checking AX windows...")
        
        if AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsRef) == .success,
           let windows = windowsRef as? [AXUIElement] {
            
            print("Found \(windows.count) AX windows")
            
            // Try to find window by title since window IDs aren't working
            for (index, axWindow) in windows.enumerated() {
                var titleRef: CFTypeRef?
                AXUIElementCopyAttributeValue(axWindow, kAXTitleAttribute as CFString, &titleRef)
                let windowName = titleRef as? String
                
                print("  Window \(index): Title: \(windowName ?? "unknown")")
                
                if windowName == windowTitle {
                    print("Found matching window by title!")
                    
                    // Unminimize if needed
                    var minimizedRef: CFTypeRef?
                    if AXUIElementCopyAttributeValue(axWindow, kAXMinimizedAttribute as CFString, &minimizedRef) == .success,
                       let isMinimized = minimizedRef as? Bool,
                       isMinimized {
                        print("Unminimizing window")
                        AXUIElementSetAttributeValue(axWindow, kAXMinimizedAttribute as CFString, false as CFTypeRef)
                        usleep(100000)
                    }
                    
                    // Unhide if needed
                    var hiddenRef: CFTypeRef?
                    if AXUIElementCopyAttributeValue(axWindow, kAXHiddenAttribute as CFString, &hiddenRef) == .success,
                       let isHidden = hiddenRef as? Bool,
                       isHidden {
                        print("Unhiding window")
                        AXUIElementSetAttributeValue(axWindow, kAXHiddenAttribute as CFString, false as CFTypeRef)
                        usleep(100000)
                    }
                    
                    print("Setting as main window and raising")
                    
                    // Try multiple methods to raise the window
                    AXUIElementSetAttributeValue(axApp, kAXMainWindowAttribute as CFString, axWindow)
                    usleep(50000)
                    
                    AXUIElementPerformAction(axWindow, kAXRaiseAction as CFString)
                    usleep(50000)
                    
                    // Try setting the window order
                    let frontmost = true as CFBoolean
                    AXUIElementSetAttributeValue(axWindow, kAXFrontmostAttribute as CFString, frontmost)
                    
                    // Final app activation
                    if #available(macOS 14.0, *) {
                        app.activate()
                    } else {
                        app.activate(options: .activateIgnoringOtherApps)
                    }

                    do {
                        try "1".write(toFile: windowOverlapPath, atomically: true, encoding: .utf8)
                    } catch {
                        print("Failed to write to file: \(error)")
                    }
                    
                    break
                }
            }
        } else {
            print("Failed to get AX windows")
        }
    } else {
        print("Failed to find application for PID: \(ownerPID)")
    }
} else {
    print("Failed to find window with ID: \(windowNumber)")
}