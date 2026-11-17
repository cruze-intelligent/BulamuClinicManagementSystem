import { describe, expect, it } from 'vitest';
import { dataUrlBytes, fitWithin, LOGO_MAX_SIDE } from './facility-logo';

describe('facility logo sizing', () => {
  it('shrinks a large photo so its longest side fits, keeping its shape', () => {
    expect(fitWithin(4000, 3000, LOGO_MAX_SIDE)).toEqual({ width: 600, height: 450 });
    expect(fitWithin(1080, 2400, LOGO_MAX_SIDE)).toEqual({ width: 270, height: 600 });
  });

  it('never enlarges a small logo', () => {
    expect(fitWithin(200, 120, LOGO_MAX_SIDE)).toEqual({ width: 200, height: 120 });
    expect(fitWithin(0, 100, LOGO_MAX_SIDE)).toEqual({ width: 0, height: 0 });
  });

  it('counts the bytes in an image address', () => {
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,' + 'A'.repeat(400))).toBe(300);
  });
});
