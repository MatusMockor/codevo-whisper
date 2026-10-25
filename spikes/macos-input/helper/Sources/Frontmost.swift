import AppKit
import CoreGraphics

enum Frontmost {
    @MainActor
    static func describe() -> JSONObject {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return ["pid": -1]
        }
        var result: JSONObject = ["pid": Int(app.processIdentifier), "window": topWindow(of: app.processIdentifier)]
        result["bundleId"] = app.bundleIdentifier ?? ""
        result["name"] = app.localizedName ?? ""
        return result
    }

    private static func topWindow(of pid: pid_t) -> JSONObject {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return [:]
        }
        guard let window = list.first(where: { ($0[kCGWindowLayer as String] as? Int) == 0 && ($0[kCGWindowOwnerPID as String] as? Int) == Int(pid) }) else {
            return [:]
        }
        return [
            "windowId": window[kCGWindowNumber as String] as? Int ?? -1,
            "bounds": window[kCGWindowBounds as String] as? [String: Int] ?? [:],
        ]
    }
}
