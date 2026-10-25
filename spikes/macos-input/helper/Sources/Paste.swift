import CoreGraphics

enum Paste {
    private static let keyV: CGKeyCode = 9

    static func commandV() -> JSONObject {
        let postAccess = CGPreflightPostEventAccess()
        guard let source = CGEventSource(stateID: .combinedSessionState) else {
            return ["posted": false, "reason": "no-event-source", "postAccess": postAccess]
        }
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyV, keyDown: true) else {
            return ["posted": false, "reason": "no-event", "postAccess": postAccess]
        }
        guard let up = CGEvent(keyboardEventSource: source, virtualKey: keyV, keyDown: false) else {
            return ["posted": false, "reason": "no-event", "postAccess": postAccess]
        }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return ["posted": true, "postAccess": postAccess]
    }
}
