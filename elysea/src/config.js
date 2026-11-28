'use strict';
/**
 * Configuration — tout ce qui dépend de l'environnement passe par ici.
 * Voir .env.example pour la liste commentée.
 */
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const env = process.env;
const isProd = env.NODE_ENV === 'production';

const config = {
  ROOT,
  isProd,
  port: Number(env.PORT || 8790),
  siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
  dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
  contentDir: path.join(ROOT, 'content'),
  publicDir: path.join(ROOT, 'public'),
  admin: {
    password: env.ADMIN_PASSWORD || (isProd ? '' : 'elysea-admin'),
    sessionHours: Number(env.ADMIN_SESSION_HOURS || 12)
  },
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    apiBase: env.STRIPE_API_BASE || 'https://api.stripe.com'
  },
  mail: {
    provider: env.MAIL_PROVIDER || (env.RESEND_API_KEY ? 'resend' : 'outbox'),
    resendKey: env.RESEND_API_KEY || '',
    resendBase: env.RESEND_API_BASE || 'https://api.resend.com',
    from: env.MAIL_FROM || 'ELYSÉA <no-reply@example.com>'
  },
  buildId: env.BUILD_ID || crypto.randomBytes(4).toString('hex')
};

module.exports = config;
