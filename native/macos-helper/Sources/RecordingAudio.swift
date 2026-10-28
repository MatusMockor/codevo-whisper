import AppKit
import CoreAudio

@MainActor
final class RecordingAudio: NSObject, NSSoundDelegate {
    private struct Snapshot {
        let uid: String
        let muted: UInt32
    }

    @MainActor private final class Lease {
        let token: Int
        let feedback: Bool
        let output: String
        let volume: Int
        var snapshot: Snapshot?
        var closing: Task<Bool, Never>?

        init(token: Int, feedback: Bool, output: String, volume: Int, snapshot: Snapshot?) {
            self.token = token
            self.feedback = feedback
            self.output = output
            self.volume = volume
            self.snapshot = snapshot
        }
    }

    private enum State {
        case idle
        case opening(Lease)
        case active(Lease)
        case closing(Lease)

        var lease: Lease? {
            switch self {
            case .idle: return nil
            case .opening(let lease), .active(let lease), .closing(let lease): return lease
            }
        }
    }

    @MainActor private final class Observation {
        var continuation: CheckedContinuation<Bool, Never>?
        var timer: Task<Void, Never>?

        func finish(_ success: Bool) {
            timer?.cancel()
            timer = nil
            continuation?.resume(returning: success)
            continuation = nil
        }
    }

    private var state = State.idle
    private var sound: NSSound?
    private var cue: CheckedContinuation<Void, Never>?
    private var cueTimer: Task<Void, Never>?
    private var observation: Observation?
    private var shuttingDown = false

    func inventory() -> JSONObject {
        let outputs = devices().compactMap { device -> JSONObject? in
            guard hasOutput(device), let uid = text(device, kAudioDevicePropertyDeviceUID),
                  let label = text(device, kAudioObjectPropertyName) else { return nil }
            return ["id": uid, "label": label]
        }
        guard !outputs.isEmpty else { return ["kind": "unavailable", "reason": "device"] }
        return ["kind": "available", "outputs": outputs, "canMute": defaultOutput().map(canMute) ?? false]
    }

    func begin(_ args: JSONObject) async -> JSONObject {
        guard let token = args["token"] as? Int, token > 0,
              let mute = args["mute"] as? Bool, let feedback = args["feedback"] as? Bool,
              let output = args["outputId"] as? String, output.count <= 512,
              let volume = args["volume"] as? Int, (0...100).contains(volume), !shuttingDown else {
            return ["begun": false, "reason": "invalid-audio-settings"]
        }
        if case .closing(let retained) = state {
            guard await close(retained, playStop: false) else {
                return ["begun": false, "reason": "restore-pending"]
            }
        }
        if case .active(let current) = state, current.token == token { return ["begun": true] }
        guard case .idle = state, !shuttingDown else { return ["begun": false, "reason": "audio-busy"] }
        var snapshot: Snapshot?
        if mute {
            guard let device = defaultOutput(), canMute(device),
                  let uid = text(device, kAudioDevicePropertyDeviceUID), let original = readMute(device) else {
                return ["begun": false, "reason": "mute-unavailable"]
            }
            snapshot = Snapshot(uid: uid, muted: original)
        }
        let lease = Lease(token: token, feedback: feedback, output: output, volume: volume, snapshot: snapshot)
        state = .opening(lease)
        if feedback { await play("Tink", lease) }
        guard case .opening(let current) = state, current === lease else {
            return ["begun": false, "reason": "audio-cancelled"]
        }
        if let snapshot {
            guard let device = device(uid: snapshot.uid), await setMute(device, 1, lease) else {
                _ = await close(lease, playStop: false)
                return ["begun": false, "reason": "mute-failed"]
            }
        }
        guard case .opening(let current) = state, current === lease else {
            return ["begun": false, "reason": "audio-cancelled"]
        }
        state = .active(lease)
        return ["begun": true]
    }

    func end(_ args: JSONObject) async -> JSONObject {
        guard let token = args["token"] as? Int, token > 0, let playStop = args["playStop"] as? Bool else {
            return ["ended": false, "reason": "invalid-audio-token"]
        }
        guard let lease = state.lease, lease.token == token else { return ["ended": true] }
        return await close(lease, playStop: playStop) ? ["ended": true] : ["ended": false, "reason": "restore-failed"]
    }

    func shutdown() async {
        shuttingDown = true
        stopCue()
        if let lease = state.lease { _ = await close(lease, playStop: false) }
    }

    private func close(_ lease: Lease, playStop: Bool) async -> Bool {
        if let closing = lease.closing { return await closing.value }
        guard state.lease === lease else { return true }
        state = .closing(lease)
        stopCue()
        observation?.finish(false)
        let closing = Task { @MainActor in
            if let snapshot = lease.snapshot {
                guard let device = self.device(uid: snapshot.uid), await self.setMute(device, snapshot.muted, lease) else {
                    self.diagnostic("Recording output restoration failed")
                    return false
                }
                lease.snapshot = nil
            }
            if playStop && lease.feedback && !self.shuttingDown { await self.play("Pop", lease) }
            if self.state.lease === lease { self.state = .idle }
            return true
        }
        lease.closing = closing
        let result = await closing.value
        lease.closing = nil
        return result
    }

    private func play(_ name: String, _ lease: Lease) async {
        guard let sound = NSSound(named: NSSound.Name(name)) else {
            diagnostic("Recording cue is missing: \(name)")
            return
        }
        sound.playbackDeviceIdentifier = devices().contains { text($0, kAudioDevicePropertyDeviceUID) == lease.output && hasOutput($0) } ? lease.output : nil
        sound.volume = Float(lease.volume) / 100
        sound.delegate = self
        self.sound = sound
        await withCheckedContinuation { continuation in
            cue = continuation
            if !sound.play() {
                diagnostic("Recording cue playback was rejected")
                stopCue()
                return
            }
            cueTimer = Task { @MainActor in
                do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
                guard self.sound === sound, self.state.lease === lease else { return }
                self.diagnostic("Recording cue reached its playback deadline")
                self.stopCue()
            }
        }
    }

    func sound(_ sound: NSSound, didFinishPlaying flag: Bool) {
        guard self.sound === sound else { return }
        if !flag { diagnostic("Recording cue did not finish successfully") }
        stopCue()
    }

    private func stopCue() {
        cueTimer?.cancel()
        cueTimer = nil
        let current = sound
        sound = nil
        current?.delegate = nil
        current?.stop()
        let continuation = cue
        cue = nil
        continuation?.resume()
    }

    private func setMute(_ device: AudioDeviceID, _ value: UInt32, _ lease: Lease) async -> Bool {
        guard state.lease === lease, canMute(device), let current = readMute(device) else { return false }
        if current == value { return true }
        let pending = Observation()
        observation = pending
        var address = muteAddress()
        let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            Task { @MainActor in
                guard let self, self.state.lease === lease, self.observation === pending else { return }
                if self.readMute(device) == value { pending.finish(true) }
            }
        }
        guard AudioObjectAddPropertyListenerBlock(device, &address, .main, listener) == noErr else {
            observation = nil
            return false
        }
        defer {
            AudioObjectRemovePropertyListenerBlock(device, &address, .main, listener)
            if observation === pending { observation = nil }
        }
        return await withCheckedContinuation { continuation in
            pending.continuation = continuation
            var requested = value
            guard AudioObjectSetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &requested) == noErr else {
                pending.finish(false)
                return
            }
            if readMute(device) == value { pending.finish(true); return }
            pending.timer = Task { @MainActor in
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                guard self.state.lease === lease, self.observation === pending else { return }
                pending.finish(self.readMute(device) == value)
            }
        }
    }

    private func muteAddress() -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
    }

    private func canMute(_ device: AudioDeviceID) -> Bool {
        var address = muteAddress()
        var writable: DarwinBoolean = false
        return AudioObjectHasProperty(device, &address) &&
            AudioObjectIsPropertySettable(device, &address, &writable) == noErr && writable.boolValue && readMute(device) != nil
    }

    private func readMute(_ device: AudioDeviceID) -> UInt32? {
        var address = muteAddress()
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr, size == MemoryLayout<UInt32>.size else { return nil }
        return value
    }

    private func defaultOutput() -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var value = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &value) == noErr, value != kAudioObjectUnknown else { return nil }
        return value
    }

    private func devices() -> [AudioDeviceID] {
        objects(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal)
    }

    private func device(uid: String) -> AudioDeviceID? {
        devices().first { text($0, kAudioDevicePropertyDeviceUID) == uid }
    }

    private func objects(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope) -> [AudioObjectID] {
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(object, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
        var values = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        let status = values.withUnsafeMutableBytes { bytes in
            guard let base = bytes.baseAddress else { return OSStatus(kAudioHardwareBadPropertySizeError) }
            return AudioObjectGetPropertyData(object, &address, 0, nil, &size, base)
        }
        return status == noErr ? values : []
    }

    private func hasOutput(_ device: AudioDeviceID) -> Bool {
        objects(device, kAudioDevicePropertyStreams, kAudioDevicePropertyScopeOutput).contains { stream in
            var address = AudioObjectPropertyAddress(mSelector: kAudioStreamPropertyVirtualFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            var format = AudioStreamBasicDescription()
            var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            return AudioObjectGetPropertyData(stream, &address, 0, nil, &size, &format) == noErr && format.mChannelsPerFrame > 0
        }
    }

    private func text(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var value: CFString = "" as CFString
        var size = UInt32(MemoryLayout<CFString>.size)
        guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value as String
    }

    private func diagnostic(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }
}
