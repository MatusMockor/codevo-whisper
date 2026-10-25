import CoreGraphics
import Foundation

@MainActor
final class KeyRecorder {
    private var generation = 0
    private var onFinish: (() -> Void)?

    var isArmed: Bool { onFinish != nil }

    func arm(timeoutMs: Int, onFinish: @escaping () -> Void) {
        generation += 1
        self.onFinish = onFinish
        let armed = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) {
            MainActor.assumeIsolated {
                guard self.generation == armed else {
                    return
                }
                self.finish()
            }
        }
    }

    func handle(type: CGEventType, keycode: Int64, flags: UInt64) {
        if type == .keyDown {
            emit("record-unsupported", keycode: keycode)
            return
        }
        guard type == .flagsChanged, ModifierKeys.isPressed(keycode: keycode, flags: flags) else {
            return
        }
        emit(ModifierKeys.supported[keycode] == nil ? "record-unsupported" : "recorded", keycode: keycode)
    }

    private func emit(_ name: String, keycode: Int64) {
        let event: JSONObject = ["event": name, "keycode": Int(keycode), "ts": Output.nowMs()]
        Output.emit(event)
        finish()
    }

    private func finish() {
        generation += 1
        let done = onFinish
        onFinish = nil
        done?()
    }
}
