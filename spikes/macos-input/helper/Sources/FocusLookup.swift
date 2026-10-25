import ApplicationServices

struct FocusLookup {
    let element: AXUIElement?
    let source: String
    let systemError: AXError
    let appError: AXError

    static func run(pid: pid_t) -> FocusLookup {
        let (system, systemError) = AXQuery.element(AXQuery.systemWide(), kAXFocusedUIElementAttribute)
        if let system {
            return FocusLookup(element: system, source: "system-wide", systemError: systemError, appError: .success)
        }
        let (app, appError) = AXQuery.element(AXQuery.application(pid), kAXFocusedUIElementAttribute)
        return FocusLookup(element: app, source: app == nil ? "none" : "app", systemError: systemError, appError: appError)
    }

    var timedOut: Bool {
        systemError == .cannotComplete && appError == .cannotComplete
    }

    func json() -> JSONObject {
        ["source": source, "systemError": AXQuery.name(systemError), "appError": AXQuery.name(appError)]
    }
}
