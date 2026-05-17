import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import pino from 'pino';
import { auth } from './auth/config.js';
import { auditLog, loginRateLimit, requireUser, type Variables } from './auth/middleware.js';
import tables from './routes/tables.js';
import sseRoute from './realtime/sseRoute.js';
import changesRoute from './realtime/changesRoute.js';
import storageRoute from './routes/storage.js';
import presignRoute from './storage/presign.js';
import { initListener } from './realtime/listener.js';

const logger = pino();
const app = new Hono<{ Variables: Variables }>();

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  }, 'request');
});

app.use('/api/auth/*', auditLog);

// Validazione dominio email: solo @opifiresafe.com è ammesso
const validateEmailDomain: MiddlewareHandler = async (c, next) => {
  try {
    const cloned = c.req.raw.clone();
    const body = await cloned.json() as { email?: string };
    if (body.email && !body.email.toLowerCase().endsWith('@opifiresafe.com')) {
      return c.json({ error: 'Accesso riservato a email @opifiresafe.com' }, 403);
    }
  } catch {
    // Se il body non è parseable, lascia passare — better-auth gestirà l'errore
  }
  return next();
}

// sign-in: rate limit + validazione dominio in un'unica registrazione
app.post('/api/auth/sign-in/email', loginRateLimit, validateEmailDomain);
app.post('/api/auth/sign-up/email', validateEmailDomain);
app.post('/api/auth/admin/create-user', validateEmailDomain);

app.all('/api/auth/*', (c) => auth.handler(c.req.raw));

app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  return requireUser(c, next);
});

app.route('/api', tables);
app.route('/api', sseRoute);
app.route('/api', changesRoute);
app.route('/api/storage', storageRoute);
app.route('/api/storage', presignRoute);

// Healthcheck pubblico per Docker e load balancer
app.get('/health', (c) => c.json({ ok: true }));

// Restituisce id, email e ruolo dell'utente corrente (senza accedere a profiles)
app.get('/api/me', requireUser, (c) => {
  const user = c.get('user');
  return c.json({ id: user.id, email: user.email, role: user.role ?? 'user' });
});

app.onError((err, c) => {
  logger.error({ err }, 'unhandled error');
  return c.json({ error: 'internal server error' }, 500);
});

const port = Number(process.env.PORT ?? '3000');

// Avvia listener LISTEN/NOTIFY in background
initListener().catch((err) => logger.error({ err }, 'listener init failed'));

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, 'opimappa api listening');
});

export default app;
