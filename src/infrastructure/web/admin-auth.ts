import { createHmac, timingSafeEqual } from 'node:crypto';

export interface AdminSession {
  username: string;
  role: 'superadmin' | 'moderator';
  issuedAt: number;
  expiresAt: number;
}

export class AdminAuthManager {
  private secretKey: string;
  private adminPasswordHash: string;

  constructor(secretKey?: string, adminPassword?: string) {
    // `JWT_SECRET`/`ADMIN_PASSWORD` are the names actually set in `.env.prod` and documented in
    // README.md - this used to read a differently-named `ADMIN_JWT_SECRET` that was never set,
    // silently falling back to a secret hardcoded in this public repo for every deployment.
    const resolvedSecret = secretKey ?? process.env.JWT_SECRET;
    const resolvedPassword = adminPassword ?? process.env.ADMIN_PASSWORD;
    if ((!resolvedSecret || !resolvedPassword) && process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET and ADMIN_PASSWORD must both be set in production - refusing to start the admin dashboard with an insecure default.',
      );
    }
    this.secretKey = resolvedSecret ?? 'dev-only-insecure-admin-jwt-secret';
    const password = resolvedPassword ?? 'admin123';
    this.adminPasswordHash = this.hashPassword(password);
  }

  /** Hash password using HMAC-SHA256 with static salt */
  private hashPassword(password: string): string {
    return createHmac('sha256', this.secretKey).update(password).digest('hex');
  }

  /** Verify admin password match */
  verifyPassword(inputPassword: string): boolean {
    const inputHash = this.hashPassword(inputPassword);
    const a = Buffer.from(inputHash, 'utf-8');
    const b = Buffer.from(this.adminPasswordHash, 'utf-8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Generate JWT token valid for 24 hours */
  generateToken(username = 'admin', role: 'superadmin' | 'moderator' = 'superadmin'): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        sub: username,
        role,
        iat: now,
        exp: now + 24 * 60 * 60, // 24 hours
      }),
    ).toString('base64url');

    const signature = createHmac('sha256', this.secretKey)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }

  /** Verify and decode JWT token */
  verifyToken(token: string): AdminSession | null {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = parts[0];
    const payload = parts[1];
    const signature = parts[2];
    if (!header || !payload || !signature) return null;

    const expectedSignature = createHmac('sha256', this.secretKey)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const sigA = Buffer.from(signature, 'utf-8');
    const sigB = Buffer.from(expectedSignature, 'utf-8');
    if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) {
      return null;
    }

    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      const now = Math.floor(Date.now() / 1000);

      if (decoded.exp && decoded.exp < now) {
        return null; // Expired
      }

      return {
        username: String(decoded.sub ?? 'admin'),
        role: (decoded.role as 'superadmin' | 'moderator') ?? 'superadmin',
        issuedAt: Number(decoded.iat ?? now),
        expiresAt: Number(decoded.exp ?? now + 86400),
      };
    } catch {
      return null;
    }
  }
}
