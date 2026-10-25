import { beginPairing, fingerprint, generateKeyPair, parsePairingToken } from '@codevo-whisper/protocol';
import type { IdentityStore } from './identity-store';
import { SecureSocket } from './secure-socket';

export async function pair(store: IdentityStore, tokenText: string, deviceName: string, print: (line: string) => void): Promise<number> {
  const token = parsePairingToken(tokenText);
  const existing = await store.load();
  const deviceKey = existing?.deviceKey ?? generateKeyPair();
  const socket = await SecureSocket.connect(token.endpoint, beginPairing(deviceKey, token));
  print(`Odtlačok zariadenia: ${fingerprint(deviceKey.publicKey)}`);
  print(`Odtlačok spojenia:   ${fingerprint(socket.handshake.handshakeHash)}`);
  print('Porovnajte odtlačok spojenia s výpisom na serveri a potvrďte párovanie tam.');
  socket.send({ type: 'pair-request', deviceName });
  const result = await socket.next();
  socket.close();
  if (result.type !== 'pair-result' || result.status !== 'approved' || result.deviceId === undefined) {
    print(result.type === 'error' ? `Chyba: ${result.code}` : 'Párovanie zamietnuté.');
    return 1;
  }
  await store.save({ deviceKey, serverPublicKey: token.serverPublicKey, endpoint: token.endpoint, deviceId: result.deviceId });
  print(`Spárované, id zariadenia ${result.deviceId}.`);
  return 0;
}
