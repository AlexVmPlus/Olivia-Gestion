/**
 * Olivia Gestion — Proxy de contact (Cloudflare Worker)
 *
 * Reçoit la soumission du formulaire de contact du site, puis :
 *   1. crée / met à jour le contact dans Brevo (POST /v3/contacts)
 *   2. envoie un email de notification à contact@olivia-gestion.fr (POST /v3/smtp/email)
 *
 * La clé API Brevo n'est JAMAIS dans le code : elle est stockée comme secret
 * Cloudflare (env.BREVO_API_KEY). Voir README.md pour le déploiement.
 */

// Origines autorisées à appeler ce Worker (CORS).
const ALLOWED_ORIGINS = [
  'https://olivia-gestion.fr',
  'https://www.olivia-gestion.fr',
];

// Adresse de notification + expéditeur (doit être un expéditeur validé dans Brevo).
const NOTIFY_TO = 'contact@olivia-gestion.fr';
const SENDER_EMAIL = 'contact@olivia-gestion.fr';
const SENDER_NAME = 'Site Olivia Gestion';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: 'Corps de requête invalide.' }, 400, cors);
    }

    // Honeypot anti-spam : si rempli, on fait semblant d'accepter sans rien envoyer.
    if ((data.website || '').toString().trim() !== '') {
      return json({ ok: true }, 200, cors);
    }

    const nom = clean(data.nom, 200);
    const email = clean(data.email, 200);
    const telephone = clean(data.telephone, 50);
    const typebien = clean(data.typebien, 100);
    const sujet = clean(data.sujet, 100);
    const message = clean(data.message, 5000);

    if (!nom || !email || !message || !isEmail(email)) {
      return json({ error: 'Champs obligatoires manquants ou email invalide.' }, 400, cors);
    }

    const apiKey = env.BREVO_API_KEY;
    if (!apiKey) {
      return json({ error: 'Configuration serveur manquante (BREVO_API_KEY).' }, 500, cors);
    }

    const brevoHeaders = {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'accept': 'application/json',
    };

    // 1) Création / mise à jour du contact (best-effort : n'interrompt pas la notification).
    try {
      await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: brevoHeaders,
        body: JSON.stringify({
          email,
          updateEnabled: true,
          attributes: {
            NOM: nom,
            TELEPHONE: telephone,
            TYPE_BIEN: typebien,
            SUJET: sujet,
            SOURCE: 'Formulaire site olivia-gestion.fr',
          },
        }),
      });
    } catch (_) {
      // on ignore : la notification email reste prioritaire
    }

    // 2) Email de notification (critique).
    const html = `
      <h2 style="font-family:Arial,sans-serif;color:#2E5EAA;">Nouvelle demande depuis le site</h2>
      <table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Nom</td><td><strong>${esc(nom)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Email</td><td>${esc(email)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Téléphone</td><td>${esc(telephone) || '—'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Type de bien</td><td>${esc(typebien) || '—'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Sujet</td><td>${esc(sujet) || '—'}</td></tr>
      </table>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#1f2a44;margin-top:16px;white-space:pre-wrap;">${esc(message)}</p>
    `;

    let emailResp;
    try {
      emailResp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: brevoHeaders,
        body: JSON.stringify({
          sender: { name: SENDER_NAME, email: SENDER_EMAIL },
          to: [{ email: NOTIFY_TO, name: 'Olivia Gestion' }],
          replyTo: { email, name: nom },
          subject: `Nouveau message du site — ${nom}`,
          htmlContent: html,
        }),
      });
    } catch (err) {
      return json({ error: 'Service email injoignable.' }, 502, cors);
    }

    if (!emailResp.ok) {
      const detail = await safeText(emailResp);
      return json({ error: 'Échec de l\'envoi.', detail }, 502, cors);
    }

    return json({ ok: true }, 200, cors);
  },
};

function clean(v, max) {
  return (v == null ? '' : String(v)).trim().slice(0, max);
}
function isEmail(v) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
async function safeText(resp) {
  try { return (await resp.text()).slice(0, 500); } catch { return ''; }
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
