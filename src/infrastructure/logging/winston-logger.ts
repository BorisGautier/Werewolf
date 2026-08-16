/**
 * Winston-based structured logger with:
 * - Console transport (colorized, readable in development)
 * - Daily rotating file transport for combined logs (15-day retention)
 * - Daily rotating file transport for error-only logs (15-day retention)
 * - JSON structured format in production files
 * - Configurable log level via env
 *
 * API: pino-compatible dual-signature support:
 *   logger.info('message')
 *   logger.info({ key: value }, 'message')   ← pino style used throughout the codebase
 *   logger.error({ err }, 'description')
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import LokiTransport from 'winston-loki';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '../../../../logs');

// ─────────────────────────────────────────────────────────────────────────────
// BigInt serialisation helper
// ─────────────────────────────────────────────────────────────────────────────

function replaceBigInt(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, replaceBigInt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom log formats
// ─────────────────────────────────────────────────────────────────────────────

/** Colorized human-readable format for the console */
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const cleanMeta = { ...meta };
    delete cleanMeta['service'];
    delete cleanMeta['pid'];
    delete cleanMeta['env'];
    const hasExtra = Object.keys(cleanMeta).length > 0;
    const metaStr = hasExtra ? ` ${safeStringify(cleanMeta)}` : '';
    return `[${timestamp as string}] ${level}: ${message as string}${metaStr}`;
  }),
);

/** Structured JSON format for file transports */
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json({ replacer: replaceBigInt }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Transport factories
// ─────────────────────────────────────────────────────────────────────────────

function makeConsoleTransport(level: string): winston.transports.ConsoleTransportInstance {
  return new winston.transports.Console({
    level,
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true,
  });
}

function makeCombinedFileTransport(): DailyRotateFile {
  return new DailyRotateFile({
    dirname: LOG_DIR,
    filename: 'werewolf-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '15d',
    maxSize: '20m',
    zippedArchive: true,
    format: fileFormat,
    handleExceptions: true,
    handleRejections: true,
    level: 'debug',
  });
}

function makeErrorFileTransport(): DailyRotateFile {
  return new DailyRotateFile({
    dirname: LOG_DIR,
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '15d',
    maxSize: '10m',
    zippedArchive: true,
    format: fileFormat,
    level: 'error',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pino-compatible logger interface
// ─────────────────────────────────────────────────────────────────────────────

type LogMeta = Record<string, unknown>;

/**
 * Matches the pino calling convention used throughout the codebase:
 *   logger.info('message')
 *   logger.info({ key: value }, 'message')
 *   logger.error({ err }, 'what happened')
 *   logger.warn({ signal }, 'Shutdown signal received')
 *
 * Using a unified `string | LogMeta` first arg avoids TypeScript overload
 * ambiguity while still accepting both pino-style call signatures.
 */
export interface PinoCompatibleLogger {
  fatal(objOrMsg: LogMeta | string, msg?: string): void;
  error(objOrMsg: LogMeta | string, msg?: string): void;
  warn(objOrMsg: LogMeta | string, msg?: string): void;
  info(objOrMsg: LogMeta | string, msg?: string): void;
  debug(objOrMsg: LogMeta | string, msg?: string): void;
  trace(objOrMsg: LogMeta | string, msg?: string): void;
  child(meta: LogMeta): PinoCompatibleLogger;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter: wraps a Winston logger to expose pino-compatible API
// ─────────────────────────────────────────────────────────────────────────────

class PinoAdapter implements PinoCompatibleLogger {
  constructor(private readonly w: winston.Logger) {}

  private log(level: string, objOrMsg: Record<string, unknown> | string, msg?: string): void {
    if (typeof objOrMsg === 'string') {
      this.w.log(level, objOrMsg);
    } else {
      // Flatten: serialize Error objects so Winston can handle them
      const meta: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(objOrMsg)) {
        if (v instanceof Error) {
          meta[k] = { message: v.message, stack: v.stack, name: v.name };
        } else {
          meta[k] = v;
        }
      }
      this.w.log(level, msg ?? '', meta);
    }
  }

  fatal(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('error', objOrMsg as Record<string, unknown>, msg);
  }
  error(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('error', objOrMsg as Record<string, unknown>, msg);
  }
  warn(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('warn', objOrMsg as Record<string, unknown>, msg);
  }
  info(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('info', objOrMsg as Record<string, unknown>, msg);
  }
  debug(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('debug', objOrMsg as Record<string, unknown>, msg);
  }
  trace(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    this.log('silly', objOrMsg as Record<string, unknown>, msg);
  }

  child(meta: Record<string, unknown>): PinoCompatibleLogger {
    return new PinoAdapter(this.w.child(meta));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Logger factory
// ─────────────────────────────────────────────────────────────────────────────

export interface WinstonLoggerOptions {
  level?: string;
  nodeEnv?: string;
  /** Optional Loki host URL (e.g. http://loki:3100) */
  lokiHost?: string;
  /** If true, skips file transports (useful in tests) */
  disableFileTransports?: boolean;
}

/**
 * Creates the application-wide Winston logger instance wrapped with the pino-compatible adapter.
 */
export function createWinstonLogger(options: WinstonLoggerOptions = {}): PinoCompatibleLogger {
  const level = options.level ?? 'info';
  const isTest = options.nodeEnv === 'test' || options.disableFileTransports;

  const transports: winston.transport[] = [makeConsoleTransport(level)];

  if (!isTest) {
    transports.push(makeCombinedFileTransport());
    transports.push(makeErrorFileTransport());

    const lokiHost = options.lokiHost ?? process.env.LOKI_HOST;
    if (lokiHost) {
      try {
        transports.push(
          new LokiTransport({
            host: lokiHost,
            labels: { service: 'werewolf-bot', env: options.nodeEnv ?? 'development' },
            json: true,
            batching: true,
            interval: 5,
          }),
        );
      } catch (err) {
        // Fallback: log console warning if Loki transport fails to initialize
        console.warn('Failed to initialize Loki transport:', err);
      }
    }
  }

  const winstonLogger = winston.createLogger({
    level: level === 'trace' ? 'silly' : level,
    defaultMeta: {
      service: 'werewolf-bot',
      pid: process.pid,
      env: options.nodeEnv ?? 'development',
    },
    transports,
    exitOnError: false,
  });

  const adapter = new PinoAdapter(winstonLogger);

  // Startup confirmation
  adapter.info(
    {
      level,
      logDir: isTest ? 'disabled' : LOG_DIR,
      fileRotation: '15 days',
      transports: isTest ? ['console'] : ['console', 'combined-file', 'error-file'],
    },
    'Winston logger initialized',
  );

  return adapter;
}

export function childLogger(
  parent: PinoCompatibleLogger,
  meta: Record<string, unknown>,
): PinoCompatibleLogger {
  return parent.child(meta);
}

export type WinstonLogger = PinoCompatibleLogger;
