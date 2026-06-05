/**
 * Invio email transazionali via Resend (HTTP API, nessuna dipendenza SMTP).
 * Usato da better-auth per il reset password.
 *
 * Env richieste:
 * - RESEND_API_KEY: API key Resend (re_...). Senza, l'invio fallisce esplicitamente.
 * - EMAIL_FROM: mittente verificato su Resend (es. "OPImaPPA <noreply@opifiresafe.com>").
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'OPImaPPA <noreply@opifiresafe.com>';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Invia una email via Resend. Lancia in caso di errore (better-auth logga e
 * risponde comunque con messaggio generico per non rivelare l'esistenza dell'account).
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY non configurata: email non inviata a', opts.to);
    throw new Error('Servizio email non configurato');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.status.toString());
    console.error('❌ Resend invio fallito:', res.status, errText);
    throw new Error('Invio email fallito');
  }
}

/**
 * Template HTML minimale per il reset password.
 */
export function resetPasswordEmail(url: string): { html: string; text: string } {
  const text =
    `Hai richiesto il reset della password per OPImaPPA.\n\n` +
    `Apri questo link per impostare una nuova password (valido 1 ora):\n${url}\n\n` +
    `Se non hai richiesto il reset, ignora questa email.`;

  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
    <h2 style="color: #b91c1c;">OPImaPPA — Reset password</h2>
    <p>Hai richiesto il reset della password.</p>
    <p>Clicca il pulsante per impostarne una nuova (link valido 1 ora):</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${url}" style="background: #b91c1c; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Reimposta password</a>
    </p>
    <p style="font-size: 12px; color: #666;">Se il pulsante non funziona, copia questo link nel browser:<br>${url}</p>
    <p style="font-size: 12px; color: #666;">Se non hai richiesto il reset, ignora questa email.</p>
  </div>`;

  return { html, text };
}
