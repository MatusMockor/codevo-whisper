import CoreGraphics
import Foundation

@MainActor
final class KeyTap {
    static let shared = KeyTap()

    private var port: CFMachPort?
    private var source: CFRunLoopSource?
    private var keycodes: Set<Int64> = []
    private var listening = false
    private let recorder = KeyRecorder()

    func listen(keycodes requested: [Int64]) -> JSONObject {
        keycodes = Set(requested.filter { ModifierKeys.supported[$0] != nil })
        guard ensureTap() else {
            return ["running": false, "reason": "tap-create-failed"]
        }
        listening = true
        return ["running": true, "keycodes": keycodes.sorted()]
    }

    func stopListening() -> JSONObject {
        listening = false
        releaseIfIdle()
        return ["running": false]
    }

    func record(timeoutMs: Int) -> JSONObject {
        guard ensureTap() else {
            return ["recording": false, "reason": "tap-create-failed"]
        }
        recorder.arm(timeoutMs: timeoutMs) { [weak self] in
            self?.releaseIfIdle()
        }
        return ["recording": true]
    }

    func handle(type: CGEventType, keycode: Int64, flags: UInt64, autorepeat: Bool) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            reenable(reason: type == .tapDisabledByTimeout ? "timeout" : "user-input")
            return
        }
        if recorder.isArmed {
            recorder.handle(type: type, keycode: keycode, flags: flags)
            return
        }
        guard listening else {
            return
        }
        if type == .keyDown {
            Shortcut.handleKeyDown(keycode: keycode, flags: flags, autorepeat: autorepeat)
            return
        }
        guard type == .flagsChanged, keycodes.contains(keycode), let mask = ModifierKeys.supported[keycode] else {
            return
        }
        let event: JSONObject = ["event": "key", "phase": flags & mask != 0 ? "down" : "up", "keycode": Int(keycode), "ts": Output.nowMs()]
        Output.emit(event)
    }

    private func ensureTap() -> Bool {
        guard port == nil else {
            return true
        }
        let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue) | CGEventMask(1 << CGEventType.keyDown.rawValue)
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: keyTapCallback,
            userInfo: nil
        ) else {
            let failure: JSONObject = ["event": "tap-error", "reason": "tap-create-failed", "listenAccess": CGPreflightListenEventAccess(), "ts": Output.nowMs()]
            Output.emit(failure)
            return false
        }
        let loopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), loopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        port = tap
        source = loopSource
        return true
    }

    private func releaseIfIdle() {
        guard !listening, !recorder.isArmed, let port else {
            return
        }
        CGEvent.tapEnable(tap: port, enable: false)
        if let source {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        }
        CFMachPortInvalidate(port)
        self.port = nil
        self.source = nil
    }

    private func reenable(reason: String) {
        guard let port else {
            return
        }
        CGEvent.tapEnable(tap: port, enable: true)
        let event: JSONObject = ["event": "tap-reenabled", "reason": reason, "ts": Output.nowMs()]
        Output.emit(event)
    }
}

private func keyTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, userInfo: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    let keycode = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags.rawValue
    let autorepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
    MainActor.assumeIsolated {
        KeyTap.shared.handle(type: type, keycode: keycode, flags: flags, autorepeat: autorepeat)
    }
    return Unmanaged.passUnretained(event)
}
