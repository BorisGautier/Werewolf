/**
 * Application logger facade.
 *
 * Wraps the Winston logger (with 15-day rotating file support) behind the
 * same `Logger` interface used across the codebase, so all call-sites remain
 * unchanged while gaining structured JSON logs in production and colorized
 * human-readable output in development.
 */

import type { Env } from '../config/env.js';
import { createWinstonLogger, type WinstonLogger } from './winston-logger.js';

export function createLogger(env: Pick<Env, 'logLevel' | 'nodeEnv'>): WinstonLogger {
  return createWinstonLogger({
    level: env.logLevel,
    nodeEnv: env.nodeEnv,
  });
}

export type Logger = WinstonLogger;
