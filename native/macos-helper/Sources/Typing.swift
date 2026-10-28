import Carbon
import CoreGraphics
import Foundation

enum Typing {
    static func typeText(_ text: String) -> JSONObject {
        guard !text.isEmpty, !text.unicodeScalars.contains(where: {
            CharacterSet.controlCharacters.contains($0) || CharacterSet.newlines.contains($0)
        }) else {
            return ["posted": false, "reason": "invalid-text"]
        }
        guard CGPreflightPostEventAccess() else {
            return ["posted": false, "reason": "post-access-denied"]
        }
        guard !IsSecureEventInputEnabled() else {
            return ["posted": false, "reason": "secure-input"]
        }
        guard let source = CGEventSource(stateID: .privateState) else {
            return ["posted": false, "reason": "no-event-source"]
        }
        var events: [CGEvent] = []
        for scalar in text.unicodeScalars {
            guard
                let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
            else {
                return ["posted": false, "reason": "no-event"]
            }
            let units = Array(String(scalar).utf16)
            for event in [down, up] {
                event.flags = []
                units.withUnsafeBufferPointer { buffer in
                    event.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
                }
                events.append(event)
            }
        }
        guard !IsSecureEventInputEnabled(), CGPreflightPostEventAccess() else {
            return ["posted": false, "reason": "posting-blocked"]
        }
        SyntheticInput.post(events)
        return ["posted": true]
    }
}
