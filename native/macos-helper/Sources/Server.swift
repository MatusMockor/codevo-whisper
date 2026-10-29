import Foundation

enum Server {
    static func start() {
        let ready: JSONObject = ["event": "ready", "ts": Output.nowMs(), "pid": Int(ProcessInfo.processInfo.processIdentifier)]
        Output.emit(ready)
        Thread.detachNewThread {
            while let line = readLine() {
                DispatchQueue.main.async {
                    Task { @MainActor in await dispatch(line) }
                }
            }
            DispatchQueue.main.async {
                Task { @MainActor in
                    await commands.shutdown()
                    exit(0)
                }
            }
        }
    }

    @MainActor
    private static let commands = Commands()

    @MainActor
    private static func dispatch(_ line: String) async {
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
        let args = NativeArguments.convert(request["args"] as? [String: Any] ?? [:])
        var response = await commands.run(name, args)
        response["id"] = id
        response["cmd"] = name
        Output.emit(response)
    }

}
