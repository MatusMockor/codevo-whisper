import Foundation

@MainActor
final class Commands {
    private static let defaultRecordTimeoutMs = 10_000

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
        case "focused-element":
            return FocusedElement.describe()
        case "modifier-flags":
            return Modifiers.describe()
        case "clipboard-save":
            return pasteboard.save()
        case "clipboard-write":
            return pasteboard.write(text: args["text"] as? String ?? "")
        case "clipboard-restore":
            return pasteboard.restore(expectedText: args["expectedText"] as? String)
        case "paste":
            return Paste.commandV()
        case "listen-start":
            return KeyTap.shared.listen(keycodes: (args["keycodes"] as? [Int] ?? []).map(Int64.init))
        case "listen-stop":
            return KeyTap.shared.stopListening()
        case "record-key":
            return KeyTap.shared.record(timeoutMs: max(args["timeoutMs"] as? Int ?? Commands.defaultRecordTimeoutMs, 0))
        default:
            return ["error": "unknown-command", "command": name]
        }
    }
}
