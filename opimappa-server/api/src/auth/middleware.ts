import type { Context, Next } from 'hono';
import pino from 'pino';
import { auth } from './config.js';
import { sql } from '../db/client.js';

export type Variables = {
  user: { id: string; email: string; role?: string | null };
  sessionId: string;
};

const logger = pino();
const failMap = new Map<string, { count: number; lastFail: number }>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const FAIL_TTL_MS = 60 * 60 * 1000; // 1 ora

function getFailCount(key: string): number {
  const entry = failMap.get(key);
  if (!entry) return 0;
  if (Date.now() - entry.lastFail > FAIL_TTL_MS) {
    failMap.delete(key);
    return 0;
  }
  return entry.count;
}

function incrFailCount(key: string): void {
  const prev = failMap.get(key);
  failMap.set(key, { count: (prev?.count ?? 0) + 1, lastFail: Date.now() });
}

function resetFailCount(key: string): void {
  failMap.delete(key);
}

type TurnstileResponse = {
  success?: boolean;
};

async function verifyTurnstile(token: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true;

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }),
  });
  const result = (await response.json()) as TurnstileResponse;
  return result.success === true;
}

export async function requireUser(c: Context<{ Variables: Variables }>, next: Next) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  c.set('user', session.user as Variables['user']);
  c.set('sessionId', session.session.id);
  return next();
}

export async function loginRateLimit(c: Context, next: Next) {
  const cloned = c.req.raw.clone();
  let body: { email?: string } | undefined;

  try {
    body = (await cloned.json()) as { email?: string };
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }

  const email = body.email?.toLowerCase();
  if (!email) {
    return c.json({ error: 'email required' }, 400);
  }

  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const key = `login:${ip}:${email}`;
  const fails = getFailCount(key);

  if (fails >= 3) {
    await sleep(Math.min(60000, Math.pow(2, fails - 3) * 1000));
  }

  if (fails >= 10 && process.env.TURNSTILE_SECRET) {
    const token = c.req.header('CF-Turnstile-Token');
    if (!token || !(await verifyTurnstile(token))) {
      return c.json({ error: 'too many attempts' }, 429);
    }
  }

  await next();

  if (c.res.status >= 400) {
    incrFailCount(key);
  } else {
    resetFailCount(key);
  }
}

export async function auditLog(c: Context<{ Variables: Partial<Variables> }>, next: Next) {
  await next();

  const userId = c.get('user')?.id ?? 'anonymous';
  const event = c.req.path;
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
  const userAgent = c.req.header('User-Agent') ?? 'unknown';
  const success = c.res.status < 400;
  const timestamp = new Date().toISOString();

  logger.info({ userId, event, ip, userAgent, success, timestamp }, 'audit');

  try {
    await sql.unsafe(
      'insert into auth_audit_log (user_id, event, ip, user_agent, success, timestamp) values ($1, $2, $3, $4, $5, $6)',
      [userId, event, ip, userAgent, success, timestamp],
    );
  } catch {
    // Audit persistence must not fail the request path.
  }
}
