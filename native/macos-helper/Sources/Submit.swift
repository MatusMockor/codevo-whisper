import Carbon
import CoreGraphics

enum Submit {
    static func send(_ mode: String) -> JSONObject {
        guard mode == "enter" || mode == "primary-enter" else {
            return ["posted": false, "reason": "invalid-submit-mode"]
        }
        guard CGPreflightPostEventAccess(), !IsSecureEventInputEnabled() else {
            return ["posted": false, "reason": "posting-blocked"]
        }
        guard let source = CGEventSource(stateID: .privateState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: 36, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 36, keyDown: false)
        else {
            return ["posted": false, "reason": "no-event"]
        }
        let events: [CGEvent]
        if mode == "primary-enter" {
            guard let commandDown = CGEvent(keyboardEventSource: source, virtualKey: 55, keyDown: true),
                  let commandUp = CGEvent(keyboardEventSource: source, virtualKey: 55, keyDown: false)
            else {
                return ["posted": false, "reason": "no-event"]
            }
            commandDown.flags = .maskCommand
            down.flags = .maskCommand
            up.flags = .maskCommand
            commandUp.flags = []
            events = [commandDown, down, up, commandUp]
        } else {
            down.flags = []
            up.flags = []
            events = [down, up]
        }
        SyntheticInput.post(events)
        return ["posted": true]
    }
}
