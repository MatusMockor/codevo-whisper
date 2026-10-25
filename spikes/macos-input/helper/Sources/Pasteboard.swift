import AppKit

@MainActor
final class Pasteboard {
    private var saved: [[(NSPasteboard.PasteboardType, Data)]]?
    private let board = NSPasteboard.general
    private let transientType = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")

    func changeCount() -> JSONObject {
        ["changeCount": board.changeCount]
    }

    func save() -> JSONObject {
        let items = board.pasteboardItems ?? []
        saved = items.map { item in
            item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }
        }
        let types = Set(items.flatMap { $0.types.map(\.rawValue) }).sorted()
        return ["items": items.count, "types": types, "changeCount": board.changeCount]
    }

    func write(text: String, transient: Bool) -> JSONObject {
        board.clearContents()
        board.setString(text, forType: .string)
        if transient {
            board.setData(Data(), forType: transientType)
        }
        return ["changeCount": board.changeCount, "transient": transient]
    }

    func restore(expectedChangeCount: Int?, expectedText: String?, force: Bool) -> JSONObject {
        guard let saved else {
            return ["restored": false, "reason": "nothing-saved"]
        }
        let current = board.changeCount
        if !force, let expectedChangeCount, current != expectedChangeCount {
            self.saved = nil
            return ["restored": false, "reason": "changecount-changed", "changeCount": current, "expected": expectedChangeCount]
        }
        if !force, let expectedText, board.string(forType: .string) != expectedText {
            self.saved = nil
            return ["restored": false, "reason": "text-changed", "changeCount": current]
        }
        board.clearContents()
        let items = saved.map { pairs in
            let item = NSPasteboardItem()
            pairs.forEach { item.setData($0.1, forType: $0.0) }
            return item
        }
        if !items.isEmpty {
            board.writeObjects(items)
        }
        self.saved = nil
        return ["restored": true, "items": items.count, "changeCount": board.changeCount]
    }
}
