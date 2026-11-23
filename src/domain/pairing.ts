export type PairingUrl = { label: string; url: string };

export type PairingTarget = { url: string; code: string; expiresAt: number };

export function pairingQrText(target: PairingTarget): string {
  return JSON.stringify({ v: 1, u: target.url, c: target.code, e: target.expiresAt });
}

export function isLoopbackBase(base: string): boolean {
  try {
    const host = new URL(base).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function choosePairingUrl(base: string, candidates: PairingUrl[]): string {
  return isLoopbackBase(base) && candidates.length > 0 ? candidates[0].url : base;
}
