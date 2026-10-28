import ApplicationServices
import CoreGraphics
import Foundation

@MainActor
final class KeyTap {
    static let shared = KeyTap()

    private var port: CFMachPort?
    private var source: CFRunLoopSource?
    private var activeTap = false
    private var binding: HotkeyBinding?
    private var listenId = 0
    private var listening = false
    private var pressed: Set<Int64> = []
    private var activeMembers: Set<Int64>?
    private var consumed: Set<Int64> = []
    private let recorder = KeyRecorder()

    func listen(_ args: JSONObject) -> JSONObject {
        guard let id = args["listenId"] as? Int, id > 0 else {
            return ["running": false, "reason": "invalid-listen-id"]
        }
        endGesture()
        binding = nil
        let requested = HotkeyBinding.parse(args)
        guard args["kind"] as? String == "none" || requested != nil else {
            reconcileTap()
            return ["running": false, "reason": "invalid-binding"]
        }
        listenId = id
        listening = true
        if requested?.isRegular == true && !AXIsProcessTrusted() {
            reconcileTap()
            return ["running": false, "reason": "accessibility-required"]
        }
        binding = requested
        pressed = ModifierKeys.currentKeys()
        guard ensureTap(active: needsActiveTap) else {
            binding = nil
            return ["running": false, "reason": "tap-create-failed"]
        }
        return ["running": true]
    }

    func stopListening() -> JSONObject {
        endGesture()
        binding = nil
        listening = false
        reconcileTap()
        return ["running": false]
    }

    func record(recordingId: Int, timeoutMs: Int) -> JSONObject {
        guard !recorder.isArmed else {
            return ["recording": false, "reason": "recording-in-progress"]
        }
        endGesture()
        guard ensureTap(active: needsActiveTap) else {
            return ["recording": false, "reason": "tap-create-failed"]
        }
        pressed = ModifierKeys.currentKeys()
        let armed = recorder.arm(recordingId: recordingId, timeoutMs: timeoutMs, held: pressed) { [weak self] in
            self?.scheduleReconcile()
        }
        return ["recording": armed]
    }

    func handle(type: CGEventType, keycode: Int64, flags: UInt64, autorepeat: Bool) -> Bool {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            reenable(reason: type == .tapDisabledByTimeout ? "timeout" : "user-input")
            return false
        }
        let wasConsumed = consumed.contains(keycode) && (type == .keyDown || type == .keyUp)
        switch type {
        case .flagsChanged:
            pressed.subtract(ModifierKeys.masks.keys)
            pressed.formUnion(ModifierKeys.pressed(flags: flags))
        case .keyDown:
            pressed.insert(keycode)
        case .keyUp:
            pressed.remove(keycode)
            consumed.remove(keycode)
        default:
            return false
        }
        if let members = activeMembers, !members.isSubset(of: pressed) {
            endGesture()
        }
        if recorder.isArmed {
            recorder.handle(type: type, keycode: keycode, flags: flags, autorepeat: autorepeat, pressed: pressed)
            if wasConsumed && type == .keyUp { scheduleReconcile() }
            return wasConsumed
        }
        if wasConsumed {
            if type == .keyUp { scheduleReconcile() }
            return true
        }
        guard listening else { return false }
        if type == .keyDown {
            Shortcut.handleKeyDown(keycode: keycode, flags: flags, autorepeat: autorepeat)
        }
        guard activeMembers == nil, let binding else { return false }
        switch binding {
        case let .modifiers(codes):
            if type == .flagsChanged && pressed.contains(keycode) && codes.contains(keycode) && codes.isSubset(of: pressed) {
                beginGesture(codes)
            }
        case let .key(code, modifiers):
            guard type == .keyDown, keycode == code, !autorepeat, ModifierKeys.normalized(flags: flags) == modifiers else {
                return false
            }
            let physical = Set(pressed.filter { key in
                guard let family = ModifierKeys.families[key] else { return false }
                return modifiers.contains(family)
            })
            guard Set(physical.compactMap { ModifierKeys.families[$0] }) == modifiers else { return false }
            consumed.insert(code)
            beginGesture(physical.union([code]))
            return true
        }
        return false
    }

    private var needsActiveTap: Bool { !consumed.isEmpty || (listening && binding?.isRegular == true) }

    private func beginGesture(_ members: Set<Int64>) {
        activeMembers = members
        Output.emit(["event": "hotkey", "listenId": listenId, "phase": "down", "ts": Output.nowMs()])
    }

    private func endGesture() {
        guard activeMembers != nil else { return }
        activeMembers = nil
        Output.emit(["event": "hotkey", "listenId": listenId, "phase": "up", "ts": Output.nowMs()])
    }

    private func ensureTap(active: Bool) -> Bool {
        if port != nil && activeTap == active { return true }
        releaseTap()
        let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue) | CGEventMask(1 << CGEventType.keyDown.rawValue) | CGEventMask(1 << CGEventType.keyUp.rawValue)
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: active ? .defaultTap : .listenOnly,
            eventsOfInterest: mask,
            callback: keyTapCallback,
            userInfo: nil
        ) else {
            Output.emit(["event": "tap-error", "reason": "tap-create-failed", "listenAccess": CGPreflightListenEventAccess(), "ts": Output.nowMs()])
            return false
        }
        let loopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), loopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        port = tap
        source = loopSource
        activeTap = active
        return true
    }

    private func scheduleReconcile() {
        DispatchQueue.main.async { [weak self] in self?.reconcileTap() }
    }

    private func reconcileTap() {
        if !listening && !recorder.isArmed && consumed.isEmpty {
            releaseTap()
            return
        }
        _ = ensureTap(active: needsActiveTap)
    }

    private func releaseTap() {
        guard let port else { return }
        CGEvent.tapEnable(tap: port, enable: false)
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        CFMachPortInvalidate(port)
        self.port = nil
        source = nil
    }

    private func reenable(reason: String) {
        guard let port else { return }
        activeMembers = nil
        pressed = ModifierKeys.currentKeys()
        consumed.formIntersection(pressed)
        recorder.inputLost(pressed: pressed)
        CGEvent.tapEnable(tap: port, enable: true)
        Output.emit(["event": "tap-reenabled", "reason": reason, "ts": Output.nowMs()])
        scheduleReconcile()
    }
}

private func keyTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, userInfo: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if event.getIntegerValueField(.eventSourceUserData) == SyntheticInput.marker {
        return Unmanaged.passUnretained(event)
    }
    let keycode = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags.rawValue
    let autorepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
    let consumed = MainActor.assumeIsolated {
        KeyTap.shared.handle(type: type, keycode: keycode, flags: flags, autorepeat: autorepeat)
    }
    return consumed ? nil : Unmanaged.passUnretained(event)
}
