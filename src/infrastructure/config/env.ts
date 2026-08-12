import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DEV_USER_IDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => BigInt(id)),
    ),
  ERROR_CHAT_ID: z
    .string()
    .optional()
    .transform((value) => (value ? BigInt(value) : undefined)),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = Readonly<{
  nodeEnv: 'development' | 'production' | 'test';
  botToken: string;
  databaseUrl: string;
  devUserIds: readonly bigint[];
  errorChatId?: bigint;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${message}`);
  }

  const { data } = parsed;
  return {
    nodeEnv: data.NODE_ENV,
    botToken: data.BOT_TOKEN,
    databaseUrl: data.DATABASE_URL,
    devUserIds: data.DEV_USER_IDS,
    ...(data.ERROR_CHAT_ID !== undefined ? { errorChatId: data.ERROR_CHAT_ID } : {}),
    logLevel: data.LOG_LEVEL,
  };
}
