import AppKit
import ApplicationServices

// Snapshot the app before a native overlay click can activate Electron. This
// follows the user's current app rather than the earlier dictation target.
@MainActor
final class OverlayFocus {
    static let shared = OverlayFocus()

    private let parentPid = getppid()
    private var clickedApp: NSRunningApplication?
    private var clickGeneration = 0

    func rememberClick() {
        clickGeneration += 1
        let app = NSWorkspace.shared.frontmostApplication
        clickedApp = app?.processIdentifier == parentPid ? nil : app
    }

    func restore() async -> JSONObject {
        let app = clickedApp
        clickedApp = nil
        let generation = clickGeneration
        guard AXIsProcessTrusted(), let front = NSWorkspace.shared.frontmostApplication else {
            return ["restored": false]
        }
        // An intervening app switch, or a click made while Electron was already
        // active, must never redirect focus to another app.
        guard front.processIdentifier == parentPid else { return ["restored": true] }
        guard let app, !app.isTerminated else { return ["restored": true] }
        let application = AXQuery.application(app.processIdentifier)
        let window = AXQuery.element(application, kAXFocusedWindowAttribute).0 ??
            AXQuery.element(application, kAXMainWindowAttribute).0
        guard generation == clickGeneration,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == parentPid else {
            return ["restored": false]
        }
        // A successful NSRunningApplication.activate request can leave Electron
        // active on current macOS. Accessibility activation performs the handoff.
        guard AXQuery.setBool(application, kAXFrontmostAttribute, true) == .success else {
            return ["restored": false]
        }
        if let window {
            _ = AXQuery.setBool(window, kAXMainAttribute, true)
            _ = AXQuery.setBool(window, kAXFocusedAttribute, true)
            _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        }
        let deadline = Date().addingTimeInterval(1)
        while Date() < deadline {
            guard generation == clickGeneration,
                  let current = NSWorkspace.shared.frontmostApplication else { break }
            if current.processIdentifier == app.processIdentifier,
               let focused = AXQuery.element(application, kAXFocusedWindowAttribute).0,
               window == nil || CFEqual(window, focused) {
                return ["restored": true]
            }
            if current.processIdentifier != parentPid && current.processIdentifier != app.processIdentifier { break }
            do { try await Task.sleep(for: .milliseconds(20)) } catch { break }
        }
        return ["restored": false]
    }
}
