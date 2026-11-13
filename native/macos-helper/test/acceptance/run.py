#!/usr/bin/env python3
"""Native macOS smoke checks. Build the helper and fixture before running.

Usage: python3 run.py /path/to/helper /path/to/fixture
Requires a logged-in desktop and Accessibility/Input Monitoring permissions.
These checks move focus between disposable fixture windows.
"""
import json
import queue
import subprocess
import sys
import threading
import time


class Peer:
    def __init__(self, path):
        self.process = subprocess.Popen([path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.messages = queue.Queue()
        self.events = []
        self.sequence = 0
        threading.Thread(target=self.read, daemon=True).start()
        print("READY", self.messages.get(timeout=10))

    def read(self):
        for line in self.process.stdout:
            self.messages.put(json.loads(line))

    def send(self, command, args=None):
        self.sequence += 1
        payload = command if args is None else json.dumps({"id": self.sequence, "cmd": command, "args": args})
        self.process.stdin.write(payload + "\n")
        self.process.stdin.flush()
        while True:
            message = self.messages.get(timeout=10)
            if args is None or message.get("id") == self.sequence:
                return message
            self.events.append(message)

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)


helper = Peer(sys.argv[1])
fixture = Peer(sys.argv[2])


def request(command, **args):
    result = helper.send(command, args)
    print(command, result)
    return result


def focus(command):
    expected = "0" if command == "first" else "1"
    for _ in range(20):
        fixture.send(command)
        time.sleep(0.3)
        if fixture.send("state")["keyWindow"].endswith(expected):
            return
    raise AssertionError("fixture window did not gain focus")


try:
    permissions = request("permissions")
    assert all(permissions[key] for key in ["accessibility", "listenEvent", "postEvent"]), permissions
    audio = request("output-audio")
    assert audio["kind"] == "available" and all(row["id"] and row["label"] for row in audio["outputs"])
    focus("first")
    capture = request("target-capture")
    assert capture["captured"], capture
    token = capture["captureId"]
    context = request("target-context", captureId=token)
    assert context["readable"] and context["before"] == "before " and context["after"] == "AFTER", context
    assert fixture.send("state")["first"] == "before AFTER"
    print("PASS readable context around caret without edits")

    focus("second")
    assert request("type-text", captureId=token, text="WRONG")["posted"] is False
    restored = request("target-refocus", captureId=token)
    assert restored["result"] == "moved", restored
    assert fixture.send("state")["keyWindow"].endswith("0")
    assert request("type-text", captureId=token, text="INSERT")["posted"]
    assert request("target-return", captureId=token)["returned"]
    assert fixture.send("state")["first"] == "before INSERTAFTER"
    time.sleep(0.3)
    state = fixture.send("state")
    assert state["keyWindow"].endswith("1") and state["second"] == "other field", state
    print("PASS original field/caret delivery and same-app window return")

    focus("first")
    unicode_capture = request("target-capture")["captureId"]
    focus("second")
    assert request("target-refocus", captureId=unicode_capture)["result"] == "moved"
    assert request("type-text", captureId=unicode_capture, text="ž😀e\u0301")["posted"]
    assert request("target-return", captureId=unicode_capture)["returned"]
    unicode_state = fixture.send("state")
    assert unicode_state["first"] == "before ž😀e\u0301INSERTAFTER", unicode_state
    assert unicode_state["caret"] == 12 and unicode_state["second"] == "other field", unicode_state
    request("target-release", captureId=unicode_capture)
    print("PASS Unicode delivery completes before immediate focus return")

    focus("secure")
    protected = request("target-capture")
    assert protected["captured"], protected
    hidden = request("target-context", captureId=protected["captureId"])
    assert hidden["readable"] is False and "before" not in hidden and "after" not in hidden, hidden
    assert fixture.send("state")["secure"] == "fixture-secret"
    request("target-release", captureId=protected["captureId"])
    print("PASS secure context withheld without edits")

    focus("second")
    fixture.send("remove")
    failed = request("target-refocus", captureId=token)
    assert failed["result"] == "failed", failed
    assert request("type-text", captureId=token, text="WRONG")["posted"] is False
    assert fixture.send("state")["second"] == "other field"
    request("target-release", captureId=token)
    print("PASS removed target blocks delivery")

    assert request("listen-start", listenId=1, kind="none")["running"]
    for shortcut_id, command, keycode, modifiers in [
        ("cancel", "escape", 53, []),
        ("lock-target", "lock", 37, ["control", "shift"]),
    ]:
        before = fixture.send("state")["escapes"]
        assert request("session-shortcuts", shortcuts=[{"id": shortcut_id, "keycode": keycode, "modifiers": modifiers}])["armed"]
        helper.events.clear()
        fixture.send(command)
        time.sleep(0.2)
        request("ping")
        assert len([event for event in helper.events if event.get("id") == shortcut_id]) == 1, helper.events
        if command == "escape":
            assert fixture.send("state")["escapes"] == before
        assert request("session-shortcuts", shortcuts=[])["armed"]
        helper.events.clear()
        fixture.send(command)
        time.sleep(0.2)
        request("ping")
        assert not any(event.get("event") == "session-shortcut" for event in helper.events), helper.events
        if command == "escape":
            assert fixture.send("state")["escapes"] == before + 1
    request("listen-stop")
    print("PASS real event-tap Esc and Ctrl+Shift+L arm/disarm")
finally:
    fixture.close()
    helper.close()
