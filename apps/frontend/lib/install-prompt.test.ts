import { describe, expect, it } from 'vitest';
import { detectPlatform } from './install-prompt';

describe('which install steps to show first', () => {
  it('recognises the device', () => {
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36')).toBe('desktop');
  });

  it('treats an iPad (which presents itself as a Mac) as iOS, but not a real Mac', () => {
    const ipadSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
    expect(detectPlatform(ipadSafari, 5)).toBe('ios');
    expect(detectPlatform(ipadSafari, 0)).toBe('desktop');
  });
});
