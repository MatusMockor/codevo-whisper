import AppKit
import ApplicationServices

@MainActor
enum ChromiumApp {
    private static var attempted: Set<pid_t> = []
    private static let markers = ["Electron Framework", "Chromium", "Google Chrome Framework", "Microsoft Edge Framework", "Brave Browser Framework", "Arc Framework", "Vivaldi Framework", "Opera Framework"]

    static func engine(of app: NSRunningApplication) -> String? {
        guard let bundle = app.bundleURL else {
            return nil
        }
        let frameworks = bundle.appendingPathComponent("Contents/Frameworks")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: frameworks.path)) ?? []
        if names.contains("Electron Framework.framework") {
            return "electron"
        }
        guard names.contains(where: { name in markers.contains(where: { name.hasPrefix($0) }) }) else {
            return nil
        }
        return "chromium"
    }

    static func enableManualAccessibility(pid: pid_t) -> JSONObject? {
        guard !attempted.contains(pid) else {
            return nil
        }
        attempted.insert(pid)
        let error = AXQuery.setBool(AXQuery.application(pid), "AXManualAccessibility", true)
        return ["attempted": true, "setResult": AXQuery.name(error)]
    }
}
