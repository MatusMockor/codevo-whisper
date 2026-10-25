export interface Transcript {
  sessionId: number
  text: string
  at: number
}

export class LastTranscript {
  private current: Transcript | null = null

  remember(sessionId: number, text: string): void {
    this.current = { sessionId, text, at: Date.now() }
  }

  get(): Transcript | null {
    return this.current
  }
}
