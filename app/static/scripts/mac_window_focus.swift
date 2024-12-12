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
        if #available(macOS 14.0, *) {
            app.activate()
        } else {
            app.activate(options: .activateIgnoringOtherApps)
        }
        
        // Attempt to bring the window to the front
        let axApp = AXUIElementCreateApplication(ownerPID)
        var value: AnyObject?
        AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &value)
        if let windows = value as? [AXUIElement] {
            for window in windows {
                AXUIElementPerformAction(window, kAXRaiseAction as CFString)
            }
        }
    }
}