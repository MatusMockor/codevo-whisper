import Foundation

enum HotkeyBinding {
    case modifiers(Set<Int64>)
    case key(Int64, Set<String>)

    static func parse(_ args: JSONObject) -> HotkeyBinding? {
        switch args["kind"] as? String {
        case "modifiers":
            guard let codes = args["keycodes"] as? [Int], !codes.isEmpty,
                  codes.allSatisfy({ ModifierKeys.masks[Int64($0)] != nil }), Set(codes).count == codes.count else {
                return nil
            }
            return .modifiers(Set(codes.map(Int64.init)))
        case "key":
            guard let code = args["keycode"] as? Int, code >= 0, code <= 127,
                  ModifierKeys.masks[Int64(code)] == nil, code != 57,
                  let modifiers = args["modifiers"] as? [String], !modifiers.isEmpty,
                  Set(modifiers).count == modifiers.count,
                  modifiers.allSatisfy({ ModifierKeys.order.contains($0) }) else {
                return nil
            }
            let binding = HotkeyBinding.key(Int64(code), Set(modifiers))
            return binding.isReserved ? nil : binding
        default:
            return nil
        }
    }

    var isRegular: Bool {
        if case .key = self { return true }
        return false
    }

    var isReserved: Bool {
        guard case let .key(code, modifiers) = self else { return false }
        return code == 9 && modifiers.contains("control") && modifiers.contains("meta") && modifiers.isDisjoint(with: ["alt", "shift"])
    }

    var fields: JSONObject {
        switch self {
        case let .modifiers(codes):
            return ["kind": "modifiers", "keycodes": codes.sorted().map(Int.init)]
        case let .key(code, modifiers):
            return ["kind": "key", "keycode": Int(code), "modifiers": ModifierKeys.order.filter { modifiers.contains($0) }]
        }
    }

    var label: String {
        switch self {
        case let .modifiers(codes):
            return codes.sorted().compactMap { ModifierKeys.labels[$0] }.joined(separator: " + ")
        case let .key(code, modifiers):
            let prefix = ModifierKeys.order.filter { modifiers.contains($0) }.compactMap { ModifierKeys.symbols[$0] }.joined()
            return prefix + (Self.keyLabels[code] ?? "Kláves \(code)")
        }
    }

    private static let keyLabels: [Int64: String] = [
        0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V",
        11: "B", 12: "Q", 13: "W", 14: "E", 15: "R", 16: "Y", 17: "T", 18: "1", 19: "2",
        20: "3", 21: "4", 22: "6", 23: "5", 25: "9", 26: "7", 28: "8", 29: "0",
        31: "O", 32: "U", 34: "I", 35: "P", 37: "L", 38: "J", 40: "K", 45: "N", 46: "M",
        36: "Return", 48: "Tab", 49: "Space", 51: "Delete", 53: "Esc", 123: "←", 124: "→", 125: "↓", 126: "↑",
    ]
}
