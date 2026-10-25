enum ModifierKeys {
    static let supported: [Int64: UInt64] = [
        54: 0x0000_0010,
        58: 0x0000_0020,
        61: 0x0000_0040,
        62: 0x0000_2000,
        63: 0x0080_0000,
    ]

    static let unsupported: [Int64: UInt64] = [
        55: 0x0000_0008,
        56: 0x0000_0002,
        59: 0x0000_0001,
        60: 0x0000_0004,
    ]

    static func isPressed(keycode: Int64, flags: UInt64) -> Bool {
        guard let mask = supported[keycode] ?? unsupported[keycode] else {
            return true
        }
        return flags & mask != 0
    }
}
