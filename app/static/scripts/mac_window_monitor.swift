import Cocoa
import Foundation

let DEBUG = false

func windowExists(windowNumber: Int) -> Bool {
    guard let windowList = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else {
        return false
    }
    return windowList.contains { ($0[kCGWindowNumber as String] as? Int) == windowNumber }
}

func isParentProcessRunning() -> Bool {
    let parentPID = getppid()
    return kill(parentPID, 0) == 0
}

func isWindowOverlapped(windowNumber: Int) -> Bool {
    guard let windowInfoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        if DEBUG { print("Failed to fetch window list.") }
        return false
    }

    guard let targetIndex = windowInfoList.firstIndex(where: {
        guard let windowID = $0[kCGWindowNumber as String] as? Int else { return false }
        return windowID == windowNumber
    }) else {
        if DEBUG { print("Window with number \(windowNumber) not found.") }
        return false
    }

    guard let targetBoundsDict = windowInfoList[targetIndex][kCGWindowBounds as String] as? [String: CGFloat] else {
        if DEBUG { print("Failed to retrieve target window bounds.") }
        return false
    }

    let targetBounds = CGRect(x: targetBoundsDict["X"] ?? 0,
                             y: targetBoundsDict["Y"] ?? 0,
                             width: targetBoundsDict["Width"] ?? 0,
                             height: targetBoundsDict["Height"] ?? 0)
    
    let targetArea = targetBounds.width * targetBounds.height

    for (index, windowInfo) in windowInfoList.enumerated() {
        guard let windowID = windowInfo[kCGWindowNumber as String] as? Int,
              let boundsDict = windowInfo[kCGWindowBounds as String] as? [String: CGFloat],
              let layer = windowInfo[kCGWindowLayer as String] as? Int,
              let ownerName = windowInfo[kCGWindowOwnerName as String] as? String else {
            if DEBUG { print("Skipped window due to missing properties") }
            continue
        }
        
        if DEBUG { print("Checking window: \(ownerName) - Layer: \(layer)") }
        
        if ownerName.contains("Dock") ||
           ownerName.contains("SystemUIServer") ||
           ownerName.contains("Window Server") ||
           ownerName.contains("Spotlight") ||
           ownerName.contains("Control Centre") ||
           (ownerName == "Finder" && (windowInfo[kCGWindowName as String] as? String) == nil) ||
           (windowInfo[kCGWindowName as String] as? String)?.lowercased().hasPrefix("__peekaview") == true ||
           (windowInfo[kCGWindowName as String] as? String)?.lowercased().hasPrefix("peekaview - ") == true {
            if DEBUG { print("Skipped system window: \(ownerName)") }
            continue
        }

        if windowID == windowNumber {
            if DEBUG { print("Skipped - same window") }
            continue
        }
        
        if index < targetIndex {
            let bounds = CGRect(x: boundsDict["X"] ?? 0,
                              y: boundsDict["Y"] ?? 0,
                              width: boundsDict["Width"] ?? 0,
                              height: boundsDict["Height"] ?? 0)

            if let intersection = targetBounds.intersection(bounds).isNull ? nil : targetBounds.intersection(bounds) {
                let overlapArea = intersection.width * intersection.height
                if DEBUG {
                    print("Window: \(ownerName) - Layer: \(layer)")
                    print("Overlap area: \(overlapArea), Target area: \(targetArea)")
                    print("Overlap ratio: \(overlapArea / targetArea)")
                }
                
                if overlapArea / targetArea > 0.05 {
                    return true
                }
            }
        } else {
            if DEBUG { print("Skipped - window is below target in z-order") }
        }
    }

    return false
}

func getWindowInfo(windowNumber: Int) -> String? {
    let windowList = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
    
    for window in windowList {
        guard let number = window[kCGWindowNumber as String] as? Int,
              number == windowNumber else { continue }
        
        guard let bounds = window[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
        
        let info: [String: Any] = [
            "x": bounds["X"] ?? 0,
            "y": bounds["Y"] ?? 0,
            "width": bounds["Width"] ?? 0,
            "height": bounds["Height"] ?? 0
        ]
        
        if let jsonData = try? JSONSerialization.data(withJSONObject: info),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            return jsonString
        }
    }
    
    return nil
}

func writeToFile(_ content: String, path: String) {
    try? content.write(toFile: path, atomically: true, encoding: .utf8)
}

// Main function to continuously monitor window state
func main() {
    let arguments = CommandLine.arguments
    guard arguments.count == 2, let windowNumber = Int(arguments[1]) else {
        print("Usage: swift mac_window_monitor.swift <windowNumber>")
        return
    }

    let windowInfoPath = "/tmp/.peekaview_windowinfo"
    let windowOverlapPath = "/tmp/.peekaview_windowoverlap"

    while true {
        // Check if parent process is still running
        if !isParentProcessRunning() {
            if DEBUG { print("Parent process no longer exists. Exiting...") }
            exit(0)
        }

        // Check if window still exists
        if !windowExists(windowNumber: windowNumber) {
            if DEBUG { print("Window no longer exists. Exiting...") }
            exit(0)
        }

        // Update window info
        if let windowInfo = getWindowInfo(windowNumber: windowNumber) {
            writeToFile(windowInfo, path: windowInfoPath)
        }

        // Update overlap status
        let isOverlapped = isWindowOverlapped(windowNumber: windowNumber)
        writeToFile(isOverlapped ? "0" : "1", path: windowOverlapPath)

        Thread.sleep(forTimeInterval: 1.0)  // Sleep for 1 second
    }
}

main()