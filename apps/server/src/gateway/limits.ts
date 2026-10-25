export const HANDSHAKE_TIMEOUT_MS = 5_000;
export const MAX_SESSION_MS = 600_000;
export const MAX_SESSION_HARD_MS = 1_800_000;
export const MAX_AUDIO_SECONDS = 600;
export const MIN_AUDIO_FRAME_BYTES = 640;
export const MESSAGE_RATE = { burst: 1000, perSecond: 200 } as const;
export const MAX_WS_PAYLOAD = 65_536;
export const INGESTION_LIMITS = { burstSeconds: 180, realTimeFactor: 1.25, pauseBelowSeconds: 30, resumeAboveSeconds: 60 } as const;

export const PRE_AUTH_LIMITS = { maxPendingTotal: 64, maxPendingPerIp: 4 } as const;
export const PROXIED_TCP_LIMITS = { maxPendingTotal: 64, maxPendingPerIp: 64 } as const;
export const MAX_SESSIONS_PER_DEVICE = 4;

export const CLOSE_NORMAL = 1000;
export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_UNSUPPORTED_DATA = 1003;
export const CLOSE_POLICY_VIOLATION = 1008;
export const CLOSE_INTERNAL_ERROR = 1011;
export const CLOSE_TRY_AGAIN_LATER = 1013;
