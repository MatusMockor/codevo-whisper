import ApplicationServices

enum FinderDesktop {
    static func isShowing(pid: pid_t) -> Bool {
        let (window, error) = AXQuery.element(AXQuery.application(pid), kAXFocusedWindowAttribute)
        guard let window else {
            return error == .noValue
        }
        let (subrole, _) = AXQuery.string(window, kAXSubroleAttribute)
        return subrole != kAXStandardWindowSubrole as String
    }
}
