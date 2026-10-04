import { describe, expect, it } from 'vitest';

import { base64ToBytes } from './base64.ts';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Reference encoder (the shared tsconfig has no Node or DOM types, so no Buffer/btoa). */
function encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    const rem = bytes.length - i;
    out += A[(n >> 18) & 63]! + A[(n >> 12) & 63]!;
    out += rem > 1 ? A[(n >> 6) & 63]! : '=';
    out += rem > 2 ? A[n & 63]! : '=';
  }
  return out;
}

describe('base64ToBytes', () => {
  it('round-trips arbitrary bytes of every padding length', () => {
    for (let len = 0; len < 40; len++) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len) & 0xff);
      expect(base64ToBytes(encode(bytes))).toEqual(bytes);
    }
  });

  it('ignores whitespace and accepts URL-safe input', () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xbf, 0x00, 0x10]);
    const b64 = encode(bytes);
    expect(base64ToBytes(`${b64.slice(0, 3)}\n${b64.slice(3)}`)).toEqual(bytes);
    expect(base64ToBytes(b64.replace(/\+/g, '-').replace(/\//g, '_'))).toEqual(bytes);
  });

  it('matches known vectors', () => {
    expect(encode(Uint8Array.from([0x66, 0x6f, 0x6f]))).toBe('Zm9v');
    expect([...base64ToBytes('Zm9vYg==')]).toEqual([0x66, 0x6f, 0x6f, 0x62]);
  });

  it('decodes a JPEG header', () => {
    expect([...base64ToBytes('/9j/4AAQ').slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('rejects invalid input', () => {
    expect(() => base64ToBytes('ab$d')).toThrow();
    expect(() => base64ToBytes('abcde')).toThrow();
  });
});
