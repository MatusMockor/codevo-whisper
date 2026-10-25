import CoreGraphics

enum Shortcut {
    private static let keyV: Int64 = 9
    private static let required: CGEventFlags = [.maskControl, .maskCommand]
    private static let excluded: CGEventFlags = [.maskShift, .maskAlternate]

    static func handleKeyDown(keycode: Int64, flags: UInt64, autorepeat: Bool) {
        let modifiers = CGEventFlags(rawValue: flags)
        guard keycode == keyV, !autorepeat, modifiers.isSuperset(of: required), modifiers.isDisjoint(with: excluded) else {
            return
        }
        let event: JSONObject = ["event": "shortcut", "name": "paste-last", "keycode": Int(keycode), "flags": Int(flags), "ts": Output.nowMs()]
        Output.emit(event)
    }
}
