# Proxy de contact Brevo — Cloudflare Worker

Ce Worker reçoit les soumissions du formulaire de contact du site
(hébergé sur GitHub Pages) et appelle l'API Brevo **côté serveur**, pour ne
jamais exposer la clé API dans le navigateur.

## ⚠️ Avant tout : régénérer la clé Brevo

La clé qui a circulé en clair doit être considérée comme **compromise**.
Dans Brevo : **SMTP & API → API Keys → supprimer l'ancienne → en générer une nouvelle**.
N'utilise que la nouvelle clé ci-dessous, et ne la mets jamais dans le code du site.

## Déploiement (une seule fois)

Prérequis : un compte Cloudflare (gratuit) et Node.js installé.

```bash
cd worker
npm install -g wrangler        # si pas déjà installé
wrangler login                 # ouvre le navigateur pour autoriser

# Enregistre la clé Brevo comme SECRET (jamais commitée) :
wrangler secret put BREVO_API_KEY
# → colle la NOUVELLE clé Brevo quand c'est demandé

wrangler deploy
```

À la fin, Wrangler affiche l'URL publique du Worker, par exemple :

```
https://olivia-gestion-contact.ton-sous-domaine.workers.dev
```

## Relier le site

Dans `index.html`, remplace la valeur de `CONTACT_API_URL` par cette URL :

```js
const CONTACT_API_URL = 'https://olivia-gestion-contact.ton-sous-domaine.workers.dev';
```

Puis `git add . && git commit && git push`.

## Vérifications côté Brevo

- **Expéditeur validé** : dans Brevo → *Senders, Domains & Dedicated IPs*,
  l'adresse `contact@olivia-gestion.fr` (ou le domaine `olivia-gestion.fr`)
  doit être vérifiée, sinon l'email de notification est refusé.
- Les origines autorisées (CORS) sont définies en haut de `worker.js`
  (`ALLOWED_ORIGINS`). Ajoute-y une URL de test si besoin.
- **Attributs de contact** : pour que `TELEPHONE`, `TYPE_BIEN`, `SUJET` et
  `SOURCE` soient enregistrés, ils doivent exister dans Brevo
  (*Contacts → Settings → Contact attributes*, type *Texte*). S'ils n'existent
  pas, la création de contact est ignorée (best-effort) mais l'email de
  notification part quand même — toutes les infos y figurent.

## Ce que fait le Worker

1. Valide les données (et ignore les bots via le champ honeypot `website`).
2. `POST /v3/contacts` — crée ou met à jour le contact (attributs NOM,
   TELEPHONE, TYPE_BIEN, SUJET, SOURCE). Best-effort.
3. `POST /v3/smtp/email` — envoie la notification à `contact@olivia-gestion.fr`
   avec `replyTo` = l'adresse du visiteur (pour répondre directement).

## Test rapide

```bash
curl -X POST https://olivia-gestion-contact.ton-sous-domaine.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"nom":"Test","email":"test@example.com","message":"Bonjour","telephone":"0600000000","typebien":"t2","sujet":"gestion"}'
# → {"ok":true}
```
