export interface FrameCodec<Request, Result> {
  readonly maxReplyBytes: number;
  encode(request: Request): Uint8Array;
  decode(reply: string, request: Request): Result;
}
