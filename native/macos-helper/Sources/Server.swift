import Foundation

enum Server {
    static func start() {
        let ready: JSONObject = ["event": "ready", "ts": Output.nowMs(), "pid": Int(ProcessInfo.processInfo.processIdentifier)]
        Output.emit(ready)
        Thread.detachNewThread {
            while let line = readLine() {
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { dispatch(line) }
                }
            }
            DispatchQueue.main.async { exit(0) }
        }
    }

    @MainActor
    private static let commands = Commands()

    @MainActor
    private static func dispatch(_ line: String) {
        guard let data = line.data(using: .utf8) else {
            return
        }
        guard let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            let failure: JSONObject = ["error": "invalid-json"]
            Output.emit(failure)
            return
        }
        let id = request["id"] as? Int ?? -1
        let name = request["cmd"] as? String ?? ""
        let args = sendable(request["args"] as? [String: Any] ?? [:])
        var response = commands.run(name, args)
        response["id"] = id
        response["cmd"] = name
        Output.emit(response)
    }

    private static func sendable(_ dictionary: [String: Any]) -> JSONObject {
        dictionary.reduce(into: JSONObject()) { result, pair in
            if let value = pair.value as? String { result[pair.key] = value; return }
            if let value = pair.value as? Bool { result[pair.key] = value; return }
            if let value = pair.value as? Int { result[pair.key] = value; return }
            if let value = pair.value as? [Int] { result[pair.key] = value; return }
            if let value = pair.value as? [String] { result[pair.key] = value }
        }
    }
}
