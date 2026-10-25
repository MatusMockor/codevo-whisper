import AppKit

@MainActor
final class Pasteboard {
    private var saved: [[(NSPasteboard.PasteboardType, Data)]]?
    private let board = NSPasteboard.general

    func save() -> JSONObject {
        let items = board.pasteboardItems ?? []
        saved = items.map { item in
            item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }
        }
        let types = Set(items.flatMap { $0.types.map(\.rawValue) }).sorted()
        return ["items": items.count, "types": types]
    }

    func write(text: String) -> JSONObject {
        board.clearContents()
        return ["written": board.setString(text, forType: .string)]
    }

    func restore(expectedText: String?) -> JSONObject {
        guard let saved else {
            return ["restored": false, "reason": "nothing-saved"]
        }
        self.saved = nil
        guard let expectedText, board.string(forType: .string) == expectedText else {
            return ["restored": false, "reason": "text-changed"]
        }
        board.clearContents()
        let items = saved.map { pairs in
            let item = NSPasteboardItem()
            pairs.forEach { item.setData($0.1, forType: $0.0) }
            return item
        }
        guard !items.isEmpty else {
            return ["restored": true, "items": 0]
        }
        board.writeObjects(items)
        return ["restored": true, "items": items.count]
    }
}
