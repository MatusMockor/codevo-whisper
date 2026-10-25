import AppKit
import ApplicationServices

@MainActor
enum SelfTestFixtures {
    static func focusFinderDesktop() -> JSONObject {
        guard let finder = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first else {
            return ["focused": false, "reason": "finder-not-running"]
        }
        finder.activate()
        usleep(400_000)
        guard let desktop = desktopArea(of: AXQuery.application(finder.processIdentifier)) else {
            return ["focused": false, "reason": "no-desktop-element"]
        }
        let error = AXQuery.setBool(desktop, kAXMainAttribute, true)
        usleep(250_000)
        return ["focused": error == .success, "reason": AXQuery.name(error)]
    }

    private static func desktopArea(of app: AXUIElement) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXChildrenAttribute as CFString, &value) == .success, let children = value as? [AXUIElement] else {
            return nil
        }
        return children.first { AXQuery.string($0, kAXRoleAttribute).0 == "AXScrollArea" }
    }
}
