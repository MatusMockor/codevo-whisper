import 'react-native-url-polyfill/auto';
import { NativeModules } from 'react-native';
import { base64 } from '@scure/base';
import * as utf8 from '@stablelib/utf8';
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encode(text) {
      return utf8.encode(text);
    }
  };
}
const native = NativeModules.CodevoVoice;
if (!native || typeof native.randomBytes !== 'function') {
  throw new Error('Codevo requires native secure randomness');
}
global.crypto = {
  getRandomValues(array) {
    if (!(array instanceof Uint8Array) || array.length > 65536) {
      throw new Error('Unsupported random buffer');
    }
    array.set(base64.decode(native.randomBytes(array.length)));
    return array;
  },
};
