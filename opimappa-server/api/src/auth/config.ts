import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { randomUUID } from 'crypto';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { sendEmail, resetPasswordEmail } from './mailer.js';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
    // Self-signup abilitato; il dominio è ristretto a @opifiresafe.com dal
    // middleware validateEmailDomain in index.ts.
    disableSignUp: false,
    autoSignIn: false,
    // Reset password via email (Resend). Il client passa redirectTo = origin app;
    // better-auth genera l'url di callback che redirige all'app con ?token=...
    sendResetPassword: async ({ user, url }) => {
      const { html, text } = resetPasswordEmail(url);
      await sendEmail({
        to: user.email,
        subject: 'Reimposta la tua password OPImaPPA',
        html,
        text,
      });
    },
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
