import Foundation

setvbuf(stdout, nil, _IONBF, 0)

MainActor.assumeIsolated {
    Server.start()
}

CFRunLoopRun()
