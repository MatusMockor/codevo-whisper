import CoreFoundation
import Foundation

enum NativeArguments {
    static func convert(_ dictionary: [String: Any]) -> JSONObject {
        dictionary.reduce(into: JSONObject()) { result, pair in
            if pair.key == "shortcuts", let value = pair.value as? [[String: Any]] { result[pair.key] = value.map(convert); return }
            if let value = pair.value as? String { result[pair.key] = value; return }
            if let number = pair.value as? NSNumber {
                if CFGetTypeID(number) == CFBooleanGetTypeID() {
                    result[pair.key] = number.boolValue
                    return
                }
                if let value = pair.value as? Int { result[pair.key] = value }
                return
            }
            if let value = pair.value as? [Int] { result[pair.key] = value; return }
            if let value = pair.value as? [String] { result[pair.key] = value }
        }
    }
}
