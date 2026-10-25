import ApplicationServices

enum AXQuery {
    static let timeoutSeconds: Float = 0.15

    static func application(_ pid: pid_t) -> AXUIElement {
        let element = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(element, timeoutSeconds)
        return element
    }

    static func systemWide() -> AXUIElement {
        let element = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(element, timeoutSeconds)
        return element
    }

    static func element(_ element: AXUIElement, _ attribute: String) -> (AXUIElement?, AXError) {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard error == .success, let value, CFGetTypeID(value) == AXUIElementGetTypeID() else {
            return (nil, error == .success ? .noValue : error)
        }
        let found = value as! AXUIElement
        AXUIElementSetMessagingTimeout(found, timeoutSeconds)
        return (found, .success)
    }

    static func string(_ element: AXUIElement, _ attribute: String) -> (String?, AXError) {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        return (value as? String, error)
    }

    static func bool(_ element: AXUIElement, _ attribute: String) -> Bool? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
            return nil
        }
        return value as? Bool
    }

    static func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
        var settable: DarwinBoolean = false
        guard AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) == .success else {
            return false
        }
        return settable.boolValue
    }

    static func names(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyAttributeNames(element, &names) == .success else {
            return []
        }
        return names as? [String] ?? []
    }

    static func pid(_ element: AXUIElement) -> Int? {
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success else {
            return nil
        }
        return Int(pid)
    }

    static func setBool(_ element: AXUIElement, _ attribute: String, _ value: Bool) -> AXError {
        AXUIElementSetAttributeValue(element, attribute as CFString, (value ? kCFBooleanTrue : kCFBooleanFalse) as CFTypeRef)
    }

    static func name(_ error: AXError) -> String {
        let names: [AXError: String] = [
            .success: "success",
            .failure: "failure",
            .illegalArgument: "illegal-argument",
            .invalidUIElement: "invalid-ui-element",
            .cannotComplete: "cannot-complete",
            .attributeUnsupported: "attribute-unsupported",
            .notImplemented: "not-implemented",
            .apiDisabled: "api-disabled",
            .noValue: "no-value",
        ]
        return names[error] ?? "ax-error-\(error.rawValue)"
    }
}
