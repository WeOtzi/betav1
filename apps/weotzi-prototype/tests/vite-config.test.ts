import { describe, expect, it } from 'vitest';
import { resolveApiOrigin } from '../vite.config.js';

describe('Vite API proxy configuration', () => {
  it('uses the same configurable server port when no explicit API origin is set', () => {
    expect(resolveApiOrigin({ PORT: '4550' })).toBe('http://127.0.0.1:4550');
  });

  it('prefers an explicit API origin and normalizes its trailing slash', () => {
    expect(resolveApiOrigin({
      PORT: '4550',
      VITE_API_ORIGIN: 'http://127.0.0.1:4660/',
    })).toBe('http://127.0.0.1:4660');
  });
});
