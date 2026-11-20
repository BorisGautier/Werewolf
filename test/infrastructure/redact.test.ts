import { describe, expect, it, vi } from 'vitest';
import {
  installConsoleRedaction,
  redactDeep,
  redactSecrets,
} from '../../src/infrastructure/logging/redact.js';
import {
  createWinstonLogger,
  redactFormat,
} from '../../src/infrastructure/logging/winston-logger.js';

const TOKEN = '1234567890:AAHabcdefghijklmnopqrstuvwxyz012345';

describe('redactSecrets', () => {
  it('masque le jeton dans une URL de l’API Telegram', () => {
    const out = redactSecrets(`request to https://api.telegram.org/bot${TOKEN}/getUpdates failed`);
    expect(out).toBe(
      'request to https://api.telegram.org/bot1234567890:<token-masque>/getUpdates failed',
    );
    expect(out).not.toContain('AAHabc');
  });

  it('masque un jeton isolé et les identifiants dans une URL de base de données', () => {
    expect(redactSecrets(`token=${TOKEN}`)).not.toContain('AAHabc');
    expect(redactSecrets('postgresql://werewolf:s3cret@db:5432/werewolf')).toBe(
      'postgresql://werewolf:***@db:5432/werewolf',
    );
  });

  it('laisse intact un texte sans secret (heures, identifiants courts)', () => {
    const text = 'Cron triggered at 12:30:00 for game 42:abc';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('redactDeep', () => {
  it('masque les chaînes imbriquées et les erreurs sans modifier l’original', () => {
    const err = new Error(`FetchError: https://api.telegram.org/bot${TOKEN}/getMe`);
    const input = { err, nested: { url: `bot${TOKEN}` }, list: [TOKEN], n: 3 };
    const out = redactDeep(input) as typeof input;
    expect(JSON.stringify({ ...out, err: out.err.message + out.err.stack })).not.toContain(
      'AAHabc',
    );
    expect(out.n).toBe(3);
    expect(err.message).toContain('AAHabc');
  });
});

describe('redactFormat (Winston)', () => {
  it('masque message, pile et métadonnées avant les transports', () => {
    const info = redactFormat().transform({
      level: 'error',
      message: `boom bot${TOKEN}`,
      err: { message: `x ${TOKEN}`, stack: `Error: bot${TOKEN}\n at y` },
    }) as Record<string, unknown>;
    expect(JSON.stringify(info)).not.toContain('AAHabc');
  });

  it('est branché sur le logger de l’application', () => {
    const logger = createWinstonLogger({ nodeEnv: 'test', level: 'error' });
    expect(() => logger.error({ err: new Error(`bot${TOKEN}`) }, 'échec')).not.toThrow();
  });
});

describe('installConsoleRedaction', () => {
  it('masque ce que les bibliothèques écrivent directement dans la console', () => {
    const sink = vi.fn();
    const fake = {
      log: sink,
      info: sink,
      warn: sink,
      error: sink,
      debug: sink,
    } as unknown as Console;
    installConsoleRedaction(fake);
    fake.error(
      '[grammY runner] Error while fetching updates:',
      new Error(`https://api.telegram.org/bot${TOKEN}/getUpdates`),
    );
    const written = String(sink.mock.calls[0]?.[0]);
    expect(written).toContain('[grammY runner] Error while fetching updates:');
    expect(written).not.toContain('AAHabc');
  });
});
