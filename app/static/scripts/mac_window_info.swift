import Cocoa

guard CommandLine.arguments.count > 1,
      let windowNumber = Int(CommandLine.arguments[1]) else {
    exit(1)
}

let windowList = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []

for window in windowList {
    guard let number = window[kCGWindowNumber as String] as? Int,
          number == windowNumber else { continue }
    
    guard let bounds = window[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    
    // Get the window's screen to determine its scale factor
    let windowRect = CGRect(x: bounds["X"] ?? 0, 
                           y: bounds["Y"] ?? 0, 
                           width: bounds["Width"] ?? 0, 
                           height: bounds["Height"] ?? 0)
    let screenWithWindow = NSScreen.screens.first { screen in
        screen.frame.intersects(windowRect)
    }
    let backingScaleFactor = screenWithWindow?.backingScaleFactor ?? 1.0
    
    // Apply scale factor to window coordinates and dimensions
    let info: [String: Any] = [
        "x": (bounds["X"] ?? 0),
        "y": (bounds["Y"] ?? 0),
        "width": (bounds["Width"] ?? 0) * backingScaleFactor,
        "height": (bounds["Height"] ?? 0) * backingScaleFactor
    ]
    
    if let jsonData = try? JSONSerialization.data(withJSONObject: info),
       let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
        exit(0)
    }
}

exit(1)