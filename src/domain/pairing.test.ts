import { describe, expect, it } from 'vitest';
import { choosePairingUrl, isLoopbackBase, pairingQrText } from './pairing';

describe('pairing qr', () => {
  it('encodes the gateway, one-time code and expiry', () => {
    const text = pairingQrText({ url: 'https://example.trycloudflare.com', code: '0123456789', expiresAt: 1000 });
    expect(JSON.parse(text)).toEqual({ v: 1, u: 'https://example.trycloudflare.com', c: '0123456789', e: 1000 });
  });

  it('detects loopback gateway addresses', () => {
    expect(isLoopbackBase('http://127.0.0.1:18787')).toBe(true);
    expect(isLoopbackBase('http://localhost:18787')).toBe(true);
    expect(isLoopbackBase('https://example.trycloudflare.com')).toBe(false);
    expect(isLoopbackBase('not a url')).toBe(false);
  });

  it('uses a LAN candidate only when the gateway is reachable only from this machine', () => {
    const candidates = [{ label: 'Wi-Fi', url: 'http://192.168.1.5:18787' }];
    expect(choosePairingUrl('http://127.0.0.1:18787', candidates)).toBe('http://192.168.1.5:18787');
    expect(choosePairingUrl('https://example.trycloudflare.com', candidates)).toBe('https://example.trycloudflare.com');
    expect(choosePairingUrl('http://127.0.0.1:18787', [])).toBe('http://127.0.0.1:18787');
  });
});
