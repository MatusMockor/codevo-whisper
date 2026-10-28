import CoreGraphics
import Foundation

@MainActor
final class KeyRecorder {
    private var generation = 0
    private var recordingId: Int?
    private var onDrained: (() -> Void)?
    private var baseline: Set<Int64> = []
    private var held: Set<Int64> = []
    private var gesture: Set<Int64> = []
    private var regular: Int64?
    private var regularModifiers: Set<String> = []
    private var frozen = false
    private var draining = false

    var isArmed: Bool { recordingId != nil || draining }

    func arm(recordingId: Int, timeoutMs: Int, held: Set<Int64>, onDrained: @escaping () -> Void) -> Bool {
        guard !isArmed else { return false }
        generation += 1
        self.recordingId = recordingId
        self.onDrained = onDrained
        baseline = held
        self.held = held
        gesture = []
        regular = nil
        regularModifiers = []
        frozen = false
        let armed = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) {
            MainActor.assumeIsolated {
                guard self.generation == armed, self.recordingId != nil else { return }
                self.finish("record-timeout")
            }
        }
        return true
    }

    func handle(type: CGEventType, keycode: Int64, flags: UInt64, autorepeat: Bool, pressed: Set<Int64>) {
        held = pressed
        if draining {
            if held.isEmpty { drained() }
            return
        }
        guard recordingId != nil else { return }
        if type == .keyDown && keycode == 53 {
            finish("record-cancelled")
            return
        }
        if !baseline.isEmpty {
            baseline = held
            return
        }
        if keycode == 57 { finish("record-unsupported"); return }
        if autorepeat { return }
        let down = type == .keyDown || (type == .flagsChanged && held.contains(keycode))
        if down {
            guard !frozen else { finish("record-unsupported"); return }
            gesture.insert(keycode)
            if type == .keyDown {
                let modifiers = ModifierKeys.normalized(flags: flags)
                guard regular == nil, !modifiers.isEmpty else { finish("record-unsupported"); return }
                regular = keycode
                regularModifiers = modifiers
            } else if regular != nil {
                finish("record-unsupported")
            }
            return
        }
        guard gesture.contains(keycode) else { return }
        frozen = true
        guard gesture.isDisjoint(with: held) else { return }
        let binding: HotkeyBinding
        if let regular {
            binding = .key(regular, regularModifiers)
        } else {
            binding = .modifiers(gesture)
        }
        guard !binding.isReserved else { finish("record-unsupported"); return }
        var fields = binding.fields
        fields["label"] = binding.label
        finish("recorded", fields: fields)
    }

    func inputLost(pressed: Set<Int64>) {
        held = pressed
        if recordingId != nil { finish("record-timeout") }
        if draining && held.isEmpty { drained() }
    }

    private func finish(_ event: String, fields: JSONObject = [:]) {
        guard let recordingId else { return }
        generation += 1
        var result = fields
        result["event"] = event
        result["recordingId"] = recordingId
        result["ts"] = Output.nowMs()
        Output.emit(result)
        self.recordingId = nil
        draining = !held.isEmpty
        if !draining { drained() }
    }

    private func drained() {
        draining = false
        let done = onDrained
        onDrained = nil
        done?()
    }
}
