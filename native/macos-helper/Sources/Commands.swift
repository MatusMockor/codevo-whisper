import Foundation

@MainActor
final class Commands {
    private static let defaultRecordTimeoutMs = 10_000

    private let pasteboard = Pasteboard()
    private let recordingAudio = RecordingAudio()
    private let overlayFocus = OverlayFocus.shared

    func shutdown() async {
        await recordingAudio.shutdown()
    }

    func run(_ name: String, _ args: JSONObject) async -> JSONObject {
        switch name {
        case "output-audio":
            return recordingAudio.inventory()
        case "recording-audio-begin":
            return await recordingAudio.begin(args)
        case "recording-audio-end":
            return await recordingAudio.end(args)
        case "ping":
            return ["pong": true, "pid": Int(ProcessInfo.processInfo.processIdentifier)]
        case "permissions":
            return Permissions.status()
        case "request-permission":
            return Permissions.request(args["kind"] as? String ?? "")
        case "frontmost":
            return Frontmost.describe()
        case "restore-frontmost-focus":
            return await overlayFocus.restore()
        case "target-capture":
            return TargetLock.capture()
        case "target-refocus":
            return await TargetLock.refocus(args["captureId"] as? String ?? "")
        case "target-return":
            return await TargetLock.returnBack(args["captureId"] as? String ?? "")
        case "target-release":
            return TargetLock.release(args["captureId"] as? String ?? "")
        case "target-context":
            return TargetLock.context(args["captureId"] as? String ?? "")
        case "check-delivery":
            if outsideCapture(args, "kind") != nil {
                return ["kind": "blocked", "reason": "focus-changed"]
            }
            return ["kind": "legacy"]
        case "secure-input":
            return SecureInput.describe()
        case "focused-element":
            return FocusedElement.describe()
        case "modifier-flags":
            return Modifiers.describe()
        case "clipboard-save":
            return pasteboard.save()
        case "clipboard-write":
            if let blocked = outsideCapture(args, "written") {
                return blocked
            }
            return pasteboard.write(text: args["text"] as? String ?? "")
        case "clipboard-restore":
            return pasteboard.restore(expectedText: args["expectedText"] as? String, force: args["force"] as? Bool ?? false)
        case "type-text":
            guard let text = args["text"] as? String else {
                return ["posted": false, "reason": "invalid-text"]
            }
            if let blocked = outsideCapture(args, "posted") {
                return blocked
            }
            if let captureId = args["captureId"] as? String {
                return await TargetLock.typeText(captureId, text: text)
            }
            return Typing.typeText(text)
        case "submit":
            if let blocked = outsideCapture(args, "posted") {
                return blocked
            }
            return Submit.send(args["mode"] as? String ?? "")
        case "paste":
            if let blocked = outsideCapture(args, "posted") {
                return blocked
            }
            return Paste.commandV()
        case "listen-start":
            return KeyTap.shared.listen(args)
        case "session-shortcuts":
            return KeyTap.shared.armSessionShortcuts(args)
        case "listen-stop":
            return KeyTap.shared.stopListening()
        case "record-key":
            guard let recordingId = args["recordingId"] as? Int, recordingId > 0 else {
                return ["recording": false, "reason": "invalid-recording-id"]
            }
            return KeyTap.shared.record(recordingId: recordingId, timeoutMs: max(args["timeoutMs"] as? Int ?? Commands.defaultRecordTimeoutMs, 0))
        default:
            return ["error": "unknown-command", "command": name]
        }
    }

    private func outsideCapture(_ args: JSONObject, _ key: String) -> JSONObject? {
        guard args.keys.contains("captureId") else {
            return nil
        }
        return TargetLock.holdsFocus(args["captureId"] as? String ?? "") ? nil : [key: false, "reason": "focus-changed"]
    }
}
