import ApplicationServices
import Foundation

struct Editability {
    let editable: Bool?
    let role: String?
    let subrole: String?
    let reason: String

    private static let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]

    static func classify(_ element: AXUIElement) -> Editability {
        let (role, roleError) = AXQuery.string(element, kAXRoleAttribute)
        let (subrole, _) = AXQuery.string(element, kAXSubroleAttribute)
        guard let role else {
            return Editability(editable: nil, role: nil, subrole: subrole, reason: "role-\(AXQuery.name(roleError))")
        }
        if textRoles.contains(role) || textRoles.contains(subrole ?? "") {
            return Editability(editable: true, role: role, subrole: subrole, reason: "text-role")
        }
        let hasTextValue = AXQuery.string(element, kAXValueAttribute).0 != nil
        if hasTextValue, AXQuery.isSettable(element, kAXValueAttribute) {
            return Editability(editable: true, role: role, subrole: subrole, reason: "settable-string-value")
        }
        if hasTextValue, role != kAXStaticTextRole as String, AXQuery.names(element).contains(kAXSelectedTextRangeAttribute) {
            return Editability(editable: true, role: role, subrole: subrole, reason: "selected-text-range")
        }
        if AXQuery.bool(element, "AXEditable") == true || AXQuery.bool(element, "AXIsEditable") == true {
            return Editability(editable: true, role: role, subrole: subrole, reason: "ax-editable")
        }
        return Editability(editable: false, role: role, subrole: subrole, reason: "not-editable")
    }

    func json() -> JSONObject {
        var result: JSONObject = ["reason": reason]
        result["editable"] = editable.map { $0 as any Sendable } ?? NSNull()
        result["role"] = role.map { $0 as any Sendable } ?? NSNull()
        result["subrole"] = subrole.map { $0 as any Sendable } ?? NSNull()
        return result
    }
}
