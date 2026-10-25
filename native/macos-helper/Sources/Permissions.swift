import ApplicationServices
import CoreGraphics

enum Permissions {
    static func status() -> JSONObject {
        [
            "listenEvent": CGPreflightListenEventAccess(),
            "postEvent": CGPreflightPostEventAccess(),
            "accessibility": AXIsProcessTrusted(),
        ]
    }

    static func request(_ kind: String) -> JSONObject {
        if kind == "listen" {
            return ["kind": kind, "granted": CGRequestListenEventAccess()]
        }
        if kind == "accessibility" {
            let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            return ["kind": kind, "granted": AXIsProcessTrustedWithOptions(options)]
        }
        return ["kind": kind, "error": "unknown-kind"]
    }
}
