/**
 * OpenTelemetry Tracing & Context Propagation helper.
 *
 * Provides W3C Trace Context propagation across Telegram update handlers,
 * assigning a unique `traceId` and `spanId` to every incoming user interaction
 * and embedding them into structured logs and metrics.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export interface TraceContext {
  traceId: string;
  spanId: string;
  updateId?: number;
  userId?: string;
  chatId?: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

/** Generates a 16-byte random hex string for OpenTelemetry traceId */
function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** Generates an 8-byte random hex string for OpenTelemetry spanId */
function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Runs a function within an OpenTelemetry trace context.
 */
export function runWithTraceContext<T>(
  ctxInfo: { updateId?: number; userId?: bigint | string | number; chatId?: bigint | string | number },
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const context: TraceContext = {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    ...(ctxInfo.updateId !== undefined ? { updateId: ctxInfo.updateId } : {}),
    ...(ctxInfo.userId !== undefined ? { userId: ctxInfo.userId.toString() } : {}),
    ...(ctxInfo.chatId !== undefined ? { chatId: ctxInfo.chatId.toString() } : {}),
  };

  return traceStorage.run(context, fn);
}

/**
 * Returns the current active trace context, or undefined if outside a traced execution.
 */
export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}
