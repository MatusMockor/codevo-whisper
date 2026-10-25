import Carbon
import IOKit

enum SecureInput {
    static func describe() -> JSONObject {
        var result: JSONObject = ["enabled": IsSecureEventInputEnabled()]
        guard let pid = secureInputPid() else {
            return result
        }
        result["pid"] = pid
        return result
    }

    private static func secureInputPid() -> Int? {
        let root = IORegistryGetRootEntry(kIOMainPortDefault)
        defer { IOObjectRelease(root) }
        guard let property = IORegistryEntryCreateCFProperty(root, "IOConsoleUsers" as CFString, kCFAllocatorDefault, 0) else {
            return nil
        }
        guard let users = property.takeRetainedValue() as? [[String: Any]] else {
            return nil
        }
        return users.compactMap { $0["kCGSSessionSecureInputPID"] as? Int }.first
    }
}
