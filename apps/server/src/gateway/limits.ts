export const HANDSHAKE_TIMEOUT_MS = 5_000;
export const MAX_SESSION_MS = 600_000;
export const MAX_AUDIO_SECONDS = 600;
export const FLOW_PAUSE_SECONDS = 300;
export const MAX_WS_PAYLOAD = 65_536;

export const PRE_AUTH_LIMITS = { maxPendingTotal: 64, maxPendingPerIp: 4, maxConnectionsPerIp: 8 } as const;

export const CLOSE_NORMAL = 1000;
export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_UNSUPPORTED_DATA = 1003;
export const CLOSE_POLICY_VIOLATION = 1008;
export const CLOSE_TRY_AGAIN_LATER = 1013;
