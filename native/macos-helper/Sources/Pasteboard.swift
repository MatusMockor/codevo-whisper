import AppKit

@MainActor
final class Pasteboard {
    private var saved: [[(NSPasteboard.PasteboardType, Data)]]?
    private var writtenChangeCount: Int?
    private let board = NSPasteboard.general

    func save() -> JSONObject {
        let items = board.pasteboardItems ?? []
        saved = items.map { item in
            item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }
        }
        writtenChangeCount = nil
        let types = Set(items.flatMap { $0.types.map(\.rawValue) }).sorted()
        return ["items": items.count, "types": types]
    }

    func write(text: String) -> JSONObject {
        board.clearContents()
        guard board.setString(text, forType: .string) else {
            writtenChangeCount = nil
            return ["written": false, "reason": "set-string-failed"]
        }
        writtenChangeCount = board.changeCount
        return ["written": true]
    }

    func restore(expectedText: String?, force: Bool) -> JSONObject {
        let written = writtenChangeCount
        writtenChangeCount = nil
        guard let saved else {
            return ["restored": false, "reason": "nothing-saved"]
        }
        self.saved = nil
        if !force, let reason = changeReason(written: written, expectedText: expectedText) {
            return ["restored": false, "reason": reason]
        }
        return put(saved)
    }

    private func changeReason(written: Int?, expectedText: String?) -> String? {
        guard let written, board.changeCount == written else {
            return "clipboard-changed"
        }
        guard let expectedText, board.string(forType: .string) == expectedText else {
            return "text-changed"
        }
        return nil
    }

    private func put(_ saved: [[(NSPasteboard.PasteboardType, Data)]]) -> JSONObject {
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
