import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())
let mode = arguments.first ?? "serve"

setvbuf(stdout, nil, _IONBF, 0)

MainActor.assumeIsolated {
    if mode == "listen" {
        let keycodes = arguments.dropFirst().compactMap { Int64($0) }
        _ = KeyTap.shared.start(keycodes: keycodes.isEmpty ? [58, 61, 63] : keycodes)
        guard KeyTap.shared.isRunning else {
            exit(2)
        }
        let ready: JSONObject = ["event": "ready", "ts": Output.nowMs(), "mode": "listen"]
        Output.emit(ready)
        return
    }
    if mode == "cmd" {
        let name = arguments.dropFirst().first ?? "ping"
        Output.emit(Commands().run(name, [:]))
        exit(0)
    }
    Server.start()
}

CFRunLoopRun()
