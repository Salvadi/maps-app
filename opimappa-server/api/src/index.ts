import { serve } from '@hono/node-server';
import { Hono } from 'hono';
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
app.post('/api/auth/sign-in/email', loginRateLimit);
app.all('/api/auth/*', (c) => auth.handler(c.req.raw));

app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  return requireUser(c, next);
});

app.use('/api/*', async (c, next) => {
  if (!['POST', 'PATCH', 'DELETE'].includes(c.req.method)) return next();
  if (c.req.path.startsWith('/api/auth/')) return next();

  const sessionId = c.get('sessionId');
  if (sessionId) {
    logger.debug({ sessionId }, 'originator session placeholder');
  }

  return next();
});

app.route('/api', tables);
app.route('/api', sseRoute);
app.route('/api', changesRoute);
app.route('/api/storage', storageRoute);
app.route('/api/storage', presignRoute);

// Healthcheck pubblico per Docker e load balancer
app.get('/health', (c) => c.json({ ok: true }));

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
