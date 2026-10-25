import Foundation

typealias JSONObject = [String: any Sendable]

enum Output {
    private static let lock = NSLock()

    static func emit(_ object: JSONObject) {
        guard JSONSerialization.isValidJSONObject(object) else {
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else {
            return
        }
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }

    static func nowMs() -> Int {
        Int((Date().timeIntervalSince1970 * 1000).rounded())
    }
}
