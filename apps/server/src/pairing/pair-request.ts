import type { SecureChannel } from '../gateway/secure-channel';

export function nextPairRequest(channel: SecureChannel): Promise<string | null> {
  return new Promise((resolve) => {
    channel.onClose(() => resolve(null));
    channel.onMessage((message) => {
      channel.onMessage(() => channel.fail('bad_message'));
      if (message.type !== 'pair-request') {
        channel.fail('bad_message');
        resolve(null);
        return;
      }
      resolve(message.deviceName);
    });
  });
}
