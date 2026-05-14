import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { randomUUID } from 'crypto';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    autoSignIn: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    cookiePrefix: '__Host-opimappa',
    useSecureCookies: true,
    cookieAttributes: { sameSite: 'lax', path: '/' },
    generateId: () => randomUUID()
  },
  rateLimit: { enabled: true, window: 60, max: 100 },
  plugins: [admin()]
});
