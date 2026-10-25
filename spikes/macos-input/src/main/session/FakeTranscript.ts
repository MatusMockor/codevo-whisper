const words = 'Ahoj toto je skúška prepisu slovenskej reči potrebujem skontrolovať náš editor a potom odoslať zmenu'.split(' ')

export class FakeTranscript {
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly intervalMs = 280) {}

  start(onText: (text: string) => void): void {
    this.stop()
    let count = 0
    this.timer = setInterval(() => {
      count += 1
      onText(words.slice(0, ((count - 1) % words.length) + 1).join(' '))
    }, this.intervalMs)
  }

  stop(): void {
    if (!this.timer) {
      return
    }
    clearInterval(this.timer)
    this.timer = null
  }

  finalText(sessionId: number): string {
    return `Codevo test ${sessionId}: ahoj, toto je skúška prepisu ľščťžýáíé. `
  }
}
