import AppKit
import CoreGraphics

@MainActor
final class FixtureTextView: NSTextView {
    var escapes = 0
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            escapes += 1
            return
        }
        super.keyDown(with: event)
    }
}

// Disposable native fields; never drive a user's documents during acceptance.
@MainActor
final class Fixture {
    let windows = (0..<2).map { index in
        let window = NSWindow(contentRect: NSRect(x: 100 + index * 450, y: 300, width: 400, height: 200),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "CODWHI-43 fixture \(index)"
        window.isReleasedWhenClosed = false
        return window
    }
    let fields = (0..<2).map { _ in FixtureTextView(frame: NSRect(x: 20, y: 50, width: 350, height: 100)) }
    let secure = NSSecureTextField(frame: NSRect(x: 20, y: 10, width: 350, height: 30))

    init() {
        for index in 0..<2 {
            fields[index].string = index == 0 ? "before AFTER" : "other field"
            windows[index].contentView?.addSubview(fields[index])
            windows[index].orderFront(nil)
        }
        secure.stringValue = "fixture-secret"
        windows[1].contentView?.addSubview(secure)
    }

    func run(_ command: String) -> [String: Any] {
        switch command {
        case "first", "second", "secure":
            let index = command == "first" ? 0 : 1
            NSApp.activate(ignoringOtherApps: true)
            windows[index].makeKeyAndOrderFront(nil)
            windows[index].makeFirstResponder(command == "secure" ? secure : fields[index])
            if command == "first" { fields[0].setSelectedRange(NSRange(location: 7, length: 0)) }
        case "remove":
            fields[0].removeFromSuperview()
            windows[0].close()
        case "escape", "lock":
            let code: CGKeyCode = command == "escape" ? 53 : 37
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)!
                event.flags = command == "lock" ? [.maskControl, .maskShift] : []
                event.post(tap: .cghidEventTap)
            }
        case "record":
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: nil, virtualKey: 61, keyDown: down)!
                event.type = .flagsChanged
                event.flags = down ? CGEventFlags(rawValue: CGEventFlags.maskAlternate.rawValue | 0x40) : []
                event.post(tap: .cghidEventTap)
            }
        case "probe":
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)!
                event.flags = []
                let text: [UniChar] = Array("probe".utf16)
                event.keyboardSetUnicodeString(stringLength: text.count, unicodeString: text)
                event.post(tap: .cghidEventTap)
            }
        default: break
        }
        let parts = command.split(separator: " ")
        if parts.count == 3, parts[0] == "click", let x = Double(parts[1]), let y = Double(parts[2]) {
            let point = CGPoint(x: x, y: y)
            for type in [CGEventType.leftMouseDown, .leftMouseUp] {
                CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
            }
        }
        return ["first": fields[0].string, "second": fields[1].string,
                "secure": secure.stringValue, "keyWindow": NSApp.keyWindow?.title ?? "",
                "caret": fields[0].selectedRange().location, "escapes": fields[1].escapes]
    }
}

setvbuf(stdout, nil, _IONBF, 0)
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let menu = NSMenu()
let editItem = NSMenuItem()
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
editItem.submenu = editMenu
menu.addItem(editItem)
app.mainMenu = menu
let fixture = MainActor.assumeIsolated { Fixture() }
func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
emit(["ready": true])
Thread.detachNewThread {
    while let command = readLine() {
        DispatchQueue.main.async {
            emit(fixture.run(command))
        }
    }
    DispatchQueue.main.async { NSApp.terminate(nil) }
}
app.run()
