import CoreGraphics

enum Modifiers {
    static func describe() -> JSONObject {
        [
            "flags": Int(CGEventSource.flagsState(.hidSystemState).rawValue),
            "combinedFlags": Int(CGEventSource.flagsState(.combinedSessionState).rawValue),
        ]
    }
}
