import CoreGraphics

enum Paste {
    private static let keyV: CGKeyCode = 9
    private static let keyCommand: CGKeyCode = 55

    static func commandV() -> JSONObject {
        let postAccess = CGPreflightPostEventAccess()
        guard postAccess else {
            return ["posted": false, "reason": "post-access-denied", "postAccess": false]
        }
        guard let source = CGEventSource(stateID: .combinedSessionState) else {
            return ["posted": false, "reason": "no-event-source", "postAccess": postAccess]
        }
        guard let events = sequence(source: source) else {
            return ["posted": false, "reason": "no-event", "postAccess": postAccess]
        }
        SyntheticInput.post(events)
        return ["posted": true, "postAccess": postAccess, "sequence": "command-down,v-down,v-up,command-up"]
    }

    private static func sequence(source: CGEventSource) -> [CGEvent]? {
        guard
            let commandDown = CGEvent(keyboardEventSource: source, virtualKey: keyCommand, keyDown: true),
            let down = CGEvent(keyboardEventSource: source, virtualKey: keyV, keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: keyV, keyDown: false),
            let commandUp = CGEvent(keyboardEventSource: source, virtualKey: keyCommand, keyDown: false)
        else {
            return nil
        }
        commandDown.flags = .maskCommand
        down.flags = .maskCommand
        up.flags = .maskCommand
        commandUp.flags = []
        return [commandDown, down, up, commandUp]
    }
}
