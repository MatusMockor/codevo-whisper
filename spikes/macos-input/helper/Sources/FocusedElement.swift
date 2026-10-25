import AppKit
import ApplicationServices

@MainActor
enum FocusedElement {
    private static let noTreeRoles: Set<String> = ["AXWindow", "AXApplication"]
    private static let retryDelaysMs: [UInt32] = [80, 150, 250, 350]

    static func describe() -> JSONObject {
        let started = Date()
        guard AXIsProcessTrusted() else {
            return unknown("no-accessibility")
        }
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return unknown("no-frontmost-app")
        }
        let engine = ChromiumApp.engine(of: app)
        var result = probe(app: app, engine: engine)
        result["pid"] = Int(app.processIdentifier)
        result["bundleId"] = app.bundleIdentifier ?? ""
        result["engine"] = engine ?? "native"
        result["elapsedMs"] = Int(Date().timeIntervalSince(started) * 1000)
        return result
    }

    private static func probe(app: NSRunningApplication, engine: String?) -> JSONObject {
        let first = evaluate(app: app, engine: engine)
        guard engine != nil, first.verdict.editable != true else {
            return first.json()
        }
        guard var manual = ChromiumApp.enableManualAccessibility(pid: app.processIdentifier) else {
            var result = first.json()
            result["manualAccessibility"] = ["attempted": false, "reason": "already-attempted"] as JSONObject
            return result
        }
        let second = retry(app: app, engine: engine)
        manual["before"] = first.verdict.editable.map { $0 as any Sendable } ?? NSNull()
        manual["helped"] = first.verdict.editable == nil && second.verdict.editable != nil
        var result = second.json()
        result["manualAccessibility"] = manual
        return result
    }

    private static func retry(app: NSRunningApplication, engine: String?) -> Evaluation {
        var last = evaluate(app: app, engine: engine)
        for delayMs in retryDelaysMs where last.verdict.editable == nil {
            usleep(delayMs * 1000)
            last = evaluate(app: app, engine: engine)
        }
        return last
    }

    private static func evaluate(app: NSRunningApplication, engine: String?) -> Evaluation {
        let lookup = FocusLookup.run(pid: app.processIdentifier)
        guard let element = lookup.element else {
            return Evaluation(lookup: lookup, verdict: withoutElement(app: app, lookup: lookup), elementPid: nil)
        }
        let verdict = Editability.classify(element)
        guard engine != nil, verdict.editable == false, noTreeRoles.contains(verdict.role ?? "") else {
            return Evaluation(lookup: lookup, verdict: verdict, elementPid: AXQuery.pid(element))
        }
        let blind = Editability(editable: nil, role: verdict.role, subrole: verdict.subrole, reason: "chromium-no-tree")
        return Evaluation(lookup: lookup, verdict: blind, elementPid: AXQuery.pid(element))
    }

    private static func withoutElement(app: NSRunningApplication, lookup: FocusLookup) -> Editability {
        if lookup.timedOut {
            return Editability(editable: nil, role: nil, subrole: nil, reason: "ax-timeout")
        }
        if app.bundleIdentifier == "com.apple.finder", FinderDesktop.isShowing(pid: app.processIdentifier) {
            return Editability(editable: false, role: nil, subrole: nil, reason: "finder-desktop")
        }
        return Editability(editable: nil, role: nil, subrole: nil, reason: "no-focused-element")
    }

    private static func unknown(_ reason: String) -> JSONObject {
        ["editable": NSNull(), "role": NSNull(), "subrole": NSNull(), "reason": reason]
    }
}

private struct Evaluation {
    let lookup: FocusLookup
    let verdict: Editability
    let elementPid: Int?

    func json() -> JSONObject {
        var result = verdict.json()
        result["lookup"] = lookup.json()
        result["elementPid"] = elementPid.map { $0 as any Sendable } ?? NSNull()
        return result
    }
}
