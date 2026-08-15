import { describe, expect, it } from 'vitest';
import { AdminAuthManager } from '../../src/infrastructure/web/admin-auth.js';

describe('AdminAuthManager', () => {
  const auth = new AdminAuthManager('secret-key-123', 'admin-pass-456');

  it('validates correct password', () => {
    expect(auth.verifyPassword('admin-pass-456')).toBe(true);
    expect(auth.verifyPassword('wrong-pass')).toBe(false);
  });

  it('generates valid JWT token and verifies it', () => {
    const token = auth.generateToken('testadmin', 'superadmin');
    expect(token).toBeTypeOf('string');
    expect(token.split('.').length).toBe(3);

    const session = auth.verifyToken(token);
    expect(session).not.toBeNull();
    expect(session?.username).toBe('testadmin');
    expect(session?.role).toBe('superadmin');
  });

  it('rejects tampered or malformed tokens', () => {
    const token = auth.generateToken('testadmin', 'superadmin');
    const tampered = token.slice(0, -5) + 'xxxxx';

    expect(auth.verifyToken(tampered)).toBeNull();
    expect(auth.verifyToken('invalid.jwt.str')).toBeNull();
    expect(auth.verifyToken('')).toBeNull();
  });
});
