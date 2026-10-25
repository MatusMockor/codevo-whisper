import CoreGraphics
import Foundation

@MainActor
final class KeyTap {
    static let shared = KeyTap()

    static let flagMasks: [Int64: UInt64] = [
        58: 0x0000_0020,
        61: 0x0000_0040,
        63: 0x0080_0000,
        54: 0x0000_0010,
        62: 0x0000_2000,
    ]

    private var port: CFMachPort?
    private var source: CFRunLoopSource?
    private var keycodes: Set<Int64> = Set(flagMasks.keys)

    var isRunning: Bool { port != nil }

    func start(keycodes requested: [Int64]) -> JSONObject {
        keycodes = Set(requested.filter { KeyTap.flagMasks[$0] != nil })
        guard port == nil else {
            return ["running": true, "keycodes": keycodes.sorted()]
        }
        let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
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
            return ["running": false, "reason": "tap-create-failed"]
        }
        let loopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), loopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        port = tap
        source = loopSource
        return ["running": true, "keycodes": keycodes.sorted()]
    }

    func stop() -> JSONObject {
        guard let port else {
            return ["running": false]
        }
        CGEvent.tapEnable(tap: port, enable: false)
        if let source {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        }
        CFMachPortInvalidate(port)
        self.port = nil
        self.source = nil
        return ["running": false]
    }

    func handle(type: CGEventType, keycode: Int64, flags: UInt64) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            reenable(reason: type == .tapDisabledByTimeout ? "timeout" : "user-input")
            return
        }
        guard type == .flagsChanged, keycodes.contains(keycode), let mask = KeyTap.flagMasks[keycode] else {
            return
        }
        let phase = flags & mask != 0 ? "down" : "up"
        let event: JSONObject = ["event": phase, "keycode": Int(keycode), "ts": Output.nowMs(), "flags": Int(flags)]
        Output.emit(event)
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
    MainActor.assumeIsolated {
        KeyTap.shared.handle(type: type, keycode: keycode, flags: flags)
    }
    return Unmanaged.passUnretained(event)
}
