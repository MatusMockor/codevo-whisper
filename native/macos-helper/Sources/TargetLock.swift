import AppKit
import ApplicationServices

@MainActor
enum TargetLock {
    private struct Capture {
        let app: NSRunningApplication
        let element: AXUIElement
        let range: CFRange?
        let sequence: Int
        var returnApp: NSRunningApplication?
        var returnElement: AXUIElement?
    }

    private static var captures: [String: Capture] = [:]
    private static var sequence = 0
    private static let captureLimit = 16
    private static let pollLimit: TimeInterval = 1
    private static let pollStep: Duration = .milliseconds(20)

    static func capture() -> JSONObject {
        guard AXIsProcessTrusted() else {
            return failure("no-accessibility")
        }
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return failure("no-target")
        }
        guard let element = FocusLookup.run(pid: app.processIdentifier).element,
              AXQuery.pid(element) == Int(app.processIdentifier)
        else {
            return failure("no-element")
        }
        if captures.count >= captureLimit, let oldest = captures.min(by: { $0.value.sequence < $1.value.sequence })?.key {
            captures.removeValue(forKey: oldest)
        }
        sequence += 1
        let id = UUID().uuidString
        captures[id] = Capture(app: app, element: element, range: selectedRange(element), sequence: sequence)
        var result = Frontmost.describe(app)
        result["captured"] = true
        result["captureId"] = id
        if let path = app.bundleURL?.path {
            result["bundlePath"] = path
        }
        return result
    }

    static func release(_ captureId: String) -> JSONObject {
        ["released": captures.removeValue(forKey: captureId) != nil]
    }

    static func holdsFocus(_ captureId: String) -> Bool {
        guard let capture = captures[captureId] else {
            return false
        }
        return isFocused(capture)
    }

    static func refocus(_ captureId: String) async -> JSONObject {
        guard var capture = captures[captureId] else {
            return failed("stale-capture")
        }
        let front = NSWorkspace.shared.frontmostApplication
        capture.returnApp = front
        capture.returnElement = front.flatMap { FocusLookup.run(pid: $0.processIdentifier).element }
        captures[captureId] = capture
        if isFocused(capture) {
            return restored(capture, "in-place")
        }
        guard !capture.app.isTerminated, NSRunningApplication(processIdentifier: capture.app.processIdentifier) != nil else {
            return failed("app-gone")
        }
        guard AXQuery.string(capture.element, kAXRoleAttribute).1 != .invalidUIElement else {
            return failed("element-gone")
        }
        guard await activate(capture.app) else {
            return failed("activation-refused")
        }
        raiseWindow(of: capture.element)
        _ = AXQuery.setBool(capture.element, kAXFocusedAttribute, true)
        guard await poll({ isFocused(capture) }) else {
            return failed("focus-refused")
        }
        return restored(capture, "moved")
    }

    static func returnBack(_ captureId: String) async -> JSONObject {
        guard let capture = captures[captureId], let app = capture.returnApp, !app.isTerminated else {
            return ["returned": false]
        }
        _ = await activate(app)
        if let element = capture.returnElement {
            raiseWindow(of: element)
            _ = AXQuery.setBool(element, kAXFocusedAttribute, true)
        }
        return ["returned": frontmostPid() == app.processIdentifier]
    }

    private static func activate(_ app: NSRunningApplication) async -> Bool {
        _ = app.activate(options: [])
        if await poll({ frontmostPid() == app.processIdentifier }) {
            return true
        }
        guard let url = app.bundleURL else {
            return false
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: configuration, completionHandler: nil)
        return await poll({ frontmostPid() == app.processIdentifier })
    }

    private static func isFocused(_ capture: Capture) -> Bool {
        guard frontmostPid() == capture.app.processIdentifier,
              let focused = FocusLookup.run(pid: capture.app.processIdentifier).element
        else {
            return false
        }
        return CFEqual(focused, capture.element)
    }

    private static func raiseWindow(of element: AXUIElement) {
        guard let window = AXQuery.element(element, kAXWindowAttribute).0 else {
            return
        }
        _ = AXQuery.setBool(window, kAXMainAttribute, true)
        _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    }

    private static func frontmostPid() -> pid_t? {
        NSWorkspace.shared.frontmostApplication?.processIdentifier
    }

    private static func poll(_ done: () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(pollLimit)
        while !done() {
            guard Date() < end else {
                return false
            }
            do { try await Task.sleep(for: pollStep) } catch { return false }
        }
        return true
    }

    private static func selectedRange(_ element: AXUIElement) -> CFRange? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXValueGetTypeID()
        else {
            return nil
        }
        var range = CFRange()
        return AXValueGetValue(value as! AXValue, .cfRange, &range) ? range : nil
    }

    private static func restored(_ capture: Capture, _ result: String) -> JSONObject {
        if var range = capture.range {
            if let value = AXValueCreate(.cfRange, &range) {
                let error = AXUIElementSetAttributeValue(capture.element, kAXSelectedTextRangeAttribute as CFString, value)
                if error != .success {
                    FileHandle.standardError.write(Data("target-lock: caret restore failed: \(AXQuery.name(error))\n".utf8))
                }
            }
            guard let now = selectedRange(capture.element), now.location == range.location, now.length == range.length else {
                return failed("caret-refused")
            }
        }
        guard isFocused(capture) else {
            return failed("focus-refused")
        }
        return ["result": result]
    }

    private static func failure(_ reason: String) -> JSONObject {
        ["captured": false, "reason": reason]
    }

    private static func failed(_ reason: String) -> JSONObject {
        ["result": "failed", "reason": reason]
    }
}
