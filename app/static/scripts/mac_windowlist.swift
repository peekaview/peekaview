import Cocoa

var result: [[String: Any]] = []

let workspace = NSWorkspace.shared
let apps = workspace.runningApplications.filter { app in 
    app.isFinishedLaunching && 
    app.activationPolicy == .regular 
    //&&  // Only include regular applications
    //!(app.bundleIdentifier?.starts(with: "com.apple.") ?? false)  // Filter out system apps
}

for app in apps {
    // Add error handling around window listing
    autoreleasepool {
        guard let windows = (try? CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]]) else {
            return // Skip if we can't get window info
        }
        
        let appWindows = windows.filter { window in 
            guard let appName = window["kCGWindowOwnerName"] as? String,
                  let isOnscreen = window["kCGWindowIsOnscreen"] as? Bool
            else { return false }
            
            return appName == app.localizedName && isOnscreen
        }
        
        if let firstWindow = appWindows.first,
           let windowNumber = firstWindow[kCGWindowNumber as String] as? Int32 {
            // Create separate entry for each window
            for window in appWindows {
                if let windowTitle = window["kCGWindowName"] as? String,
                   let windowNum = window[kCGWindowNumber as String] as? Int32 {
                    let webrtcId = String(windowNum)
                    
                    result.append([
                        "processName": app.localizedName ?? "",
                        "id": webrtcId,
                        "windows": [windowTitle]
                    ])
                }
            }
        }
    }
}

if let jsonData = try? JSONSerialization.data(withJSONObject: ["data": result], options: [.prettyPrinted, .sortedKeys]),
   let jsonString = String(data: jsonData, encoding: .utf8) {
    print(jsonString)
}