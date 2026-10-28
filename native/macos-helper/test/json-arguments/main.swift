import Foundation

for keycode in 0...2 {
    let json = """
    {"listenId":1,"recordingId":1,"keycode":\(keycode),"timeoutMs":10000,"force":true,"disabled":false,"keycodes":[0,1,2],"modifiers":["control","shift"],"text":"hello"}
    """
    guard let raw = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
        fatalError("Invalid test JSON")
    }
    let args = NativeArguments.convert(raw)
    precondition(args["listenId"] as? Int == 1)
    precondition(args["recordingId"] as? Int == 1)
    precondition(args["keycode"] as? Int == keycode)
    precondition(args["timeoutMs"] as? Int == 10000)
    precondition(args["force"] as? Bool == true)
    precondition(args["disabled"] as? Bool == false)
    precondition(!(args["force"] is Int) && !(args["disabled"] is Int))
    precondition(args["keycodes"] as? [Int] == [0, 1, 2])
    precondition(args["modifiers"] as? [String] == ["control", "shift"])
    precondition(args["text"] as? String == "hello")
}
print("PASS native JSON argument identity")
