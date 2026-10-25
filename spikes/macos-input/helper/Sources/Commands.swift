import Foundation

@MainActor
final class Commands {
    private let pasteboard = Pasteboard()

    func run(_ name: String, _ args: JSONObject) -> JSONObject {
        switch name {
        case "ping":
            return ["pong": true, "pid": Int(ProcessInfo.processInfo.processIdentifier)]
        case "permissions":
            return Permissions.status()
        case "request-permission":
            return Permissions.request(args["kind"] as? String ?? "")
        case "frontmost":
            return Frontmost.describe()
        case "secure-input":
            return SecureInput.describe()
        case "clipboard-save":
            return pasteboard.save()
        case "clipboard-write":
            return pasteboard.write(text: args["text"] as? String ?? "", transient: args["transient"] as? Bool ?? false)
        case "clipboard-changecount":
            return pasteboard.changeCount()
        case "clipboard-restore":
            return pasteboard.restore(
                expectedChangeCount: args["expectedChangeCount"] as? Int,
                expectedText: args["expectedText"] as? String,
                force: args["force"] as? Bool ?? false
            )
        case "paste":
            return Paste.commandV()
        case "listen-start":
            return KeyTap.shared.start(keycodes: (args["keycodes"] as? [Int] ?? [54, 58, 61, 62, 63]).map(Int64.init))
        case "listen-stop":
            return KeyTap.shared.stop()
        default:
            return ["error": "unknown-command", "command": name]
        }
    }
}
