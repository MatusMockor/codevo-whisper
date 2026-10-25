import AppKit
import CoreGraphics

enum Frontmost {
    @MainActor
    static func describe() -> JSONObject {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return ["pid": -1]
        }
        return [
            "pid": Int(app.processIdentifier),
            "bundleId": app.bundleIdentifier ?? "",
            "name": app.localizedName ?? "",
            "windowId": topWindowId(of: app.processIdentifier).map { $0 as any Sendable } ?? NSNull(),
        ]
    }

    private static func topWindowId(of pid: pid_t) -> Int? {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        let window = list.first { ($0[kCGWindowLayer as String] as? Int) == 0 && ($0[kCGWindowOwnerPID as String] as? Int) == Int(pid) }
        return window?[kCGWindowNumber as String] as? Int
    }
}
