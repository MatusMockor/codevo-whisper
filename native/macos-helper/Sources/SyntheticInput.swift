import CoreGraphics

enum SyntheticInput {
    static let marker: Int64 = 0x43574F5554505554

    static func post(_ events: [CGEvent]) {
        for event in events {
            event.setIntegerValueField(.eventSourceUserData, value: marker)
            event.post(tap: .cghidEventTap)
        }
    }
}
