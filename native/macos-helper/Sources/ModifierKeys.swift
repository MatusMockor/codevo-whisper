import CoreGraphics

enum ModifierKeys {
    static let masks: [Int64: UInt64] = [
        54: 0x0000_0010, 55: 0x0000_0008,
        56: 0x0000_0002, 60: 0x0000_0004,
        58: 0x0000_0020, 61: 0x0000_0040,
        59: 0x0000_0001, 62: 0x0000_2000,
        63: 0x0080_0000,
    ]
    static let order = ["control", "alt", "shift", "meta", "fn"]
    static let families: [Int64: String] = [
        54: "meta", 55: "meta", 56: "shift", 60: "shift", 58: "alt", 61: "alt", 59: "control", 62: "control", 63: "fn",
    ]
    static let symbols = ["control": "⌃", "alt": "⌥", "shift": "⇧", "meta": "⌘", "fn": "Fn+"]
    static let labels: [Int64: String] = [
        54: "Pravý ⌘ Command", 55: "Ľavý ⌘ Command", 56: "Ľavý ⇧ Shift", 60: "Pravý ⇧ Shift",
        58: "Ľavý ⌥ Option", 61: "Pravý ⌥ Option", 59: "Ľavý ⌃ Control", 62: "Pravý ⌃ Control", 63: "Fn / 🌐",
    ]

    static func pressed(flags: UInt64) -> Set<Int64> {
        Set(masks.compactMap { flags & $0.value != 0 ? $0.key : nil })
    }

    static func normalized(flags: UInt64) -> Set<String> {
        let masks: [(String, UInt64)] = [("control", 0x40000), ("alt", 0x80000), ("shift", 0x20000), ("meta", 0x100000), ("fn", 0x800000)]
        return Set(masks.compactMap { flags & $0.1 != 0 ? $0.0 : nil })
    }

    static func currentKeys() -> Set<Int64> {
        Set((Int64(0)...127).filter { CGEventSource.keyState(.hidSystemState, key: CGKeyCode($0)) })
    }
}
