export type HandshakePattern = 'IK' | 'IKpsk2';

export type Token = 'e' | 's' | 'ee' | 'es' | 'se' | 'ss' | 'psk';

export type PatternDefinition = {
  protocolName: string;
  responderPreMessage: readonly Token[];
  messages: readonly (readonly Token[])[];
  usesPsk: boolean;
};

export const PATTERNS: Record<HandshakePattern, PatternDefinition> = {
  IK: {
    protocolName: 'Noise_IK_25519_ChaChaPoly_BLAKE2s',
    responderPreMessage: ['s'],
    messages: [
      ['e', 'es', 's', 'ss'],
      ['e', 'ee', 'se'],
    ],
    usesPsk: false,
  },
  IKpsk2: {
    protocolName: 'Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s',
    responderPreMessage: ['s'],
    messages: [
      ['e', 'es', 's', 'ss'],
      ['e', 'ee', 'se', 'psk'],
    ],
    usesPsk: true,
  },
};
