import pino from 'pino';
import type { Env } from '../config/env.js';

export function createLogger(env: Pick<Env, 'logLevel' | 'nodeEnv'>) {
  return pino({
    level: env.logLevel,
    ...(env.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
