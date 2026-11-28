# ELYSÉA — Smart Vanity Collection

Boutique e-commerce premium dédiée à la coiffeuse cylindrique ELYSÉA : miroir rabattable,
rangement intérieur et pouf demi-lune intégré. Site bilingue (FR/EN), expérience 3D
interactive, tunnel de commande Stripe, e-mails transactionnels et administration.

```bash
cd elysea
npm install
npm start                 # → http://localhost:8790   (admin : /admin, mot de passe de dev « elysea-admin »)
npm test                  # 32 tests d'intégration (API, paiement, Stripe simulé, admin, SEO)
npm run test:e2e          # 8 parcours navigateur (achat complet, admin, mobile, accessibilité)
```

Node 20 ou plus. Une seule dépendance d'exécution : `three`.

---

## Ce qui est livré

| Domaine | Contenu |
|---|---|
| **Pages** | Accueil (hero plein écran + parallaxe), Fiche produit, Conception (scrollytelling 3D), Matières (loupe), Inspiration (5 intérieurs), Contact + FAQ, Panier, Commande, Confirmation, Mentions légales, CGV, Confidentialité, 404 |
| **3D** | Modèle procédural fidèle aux cotes (Ø 65 × 83 cm), tissu côtelé à rayures (cartes de couleur, relief et rugosité générées), miroir plan réel (`Reflector`), ombres douces, rotation 360°, ouverture du miroir, sortie du pouf, zoom matière. Rendu à la demande, pause hors écran, repli sans WebGL |
| **Visuels** | 23 rendus générés depuis ce même modèle (studio, gros plans, 5 intérieurs, hero bureau + mobile) en AVIF / WebP / JPEG, 3 tailles chacun |
| **E-commerce** | Variantes, prix et promotions configurables, panier (tiroir + page), frais de livraison par zone, stock décrémenté au paiement, Stripe Checkout + webhook signé, mode démonstration, confirmation, e-mails client / boutique / expédition |
| **Admin** | Tableau de bord (CA, alertes de configuration), commandes (statuts, suivi, export CSV), produit / prix / promotion / variantes / stock, photos (conversion WebP dans le navigateur), modèle 3D GLB, livraison, tous les textes FR/EN, FAQ, témoignages, messages, journal des e-mails, paramètres et pages légales |
| **SEO / perf.** | Rendu serveur, title/description par page et par langue, canonical, hreflang, Open Graph, JSON-LD Product / BreadcrumbList / FAQPage / Organization, sitemap, robots, images AVIF/WebP + `srcset` + chargement différé, polices auto-hébergées, compression Brotli, cache immuable versionné |
| **Accessibilité** | Lien d'évitement, focus visibles, piège de focus dans le tiroir, navigation clavier (galerie, viewer 3D), `prefers-reduced-motion`, textes alternatifs, un seul `h1` par page |
| **Sécurité** | CSP à nonce, en-têtes de sécurité, cookie admin HttpOnly/SameSite=Strict, en-tête anti-CSRF, limitation de débit, prix toujours recalculés côté serveur, signature des fichiers téléversés vérifiée, anti-traversée de répertoires |

Mesures locales (accueil, bureau) : LCP ≈ 1,4 s, CLS ≈ 0, 257 Ko transférés, 15 requêtes.

---

## Avant l'ouverture — à configurer (rien n'a été inventé)

Le tableau de bord de l'admin liste ces points tant qu'ils ne sont pas réglés.

1. **Prix** — 590 € est une **valeur d'exemple** (admin › Produit & stock).
2. **Livraison** — les tarifs (France 49 €, Belgique/Luxembourg/Monaco 89 €) sont des **exemples** ; cochez « Livraison configurée » une fois vérifiés.
3. **Conditions** — livraison, retours, garantie : vides par défaut. La FAQ affiche alors un message d'attente invitant à vous contacter.
4. **Pages légales** — mentions légales, CGV, confidentialité (admin › Paramètres).
5. **Coordonnées** — e-mail de contact et de notification des commandes.
6. **Stripe** et **Resend** — variables d'environnement ci-dessous.
7. **Photos réelles** — remplacez ou complétez les rendus (admin › Photos & 3D).

Les caractéristiques fournisseur (dimensions, volume, poids, matériaux) sont présentées comme
« communiquées par le fabricant », sans certification ni garantie. Les témoignages n'apparaissent
que lorsqu'un avis réel est publié dans l'admin.

---

## Configuration

Voir `.env.example`.

| Variable | Rôle |
|---|---|
| `SITE_URL` | URL publique (canonical, sitemap, liens des e-mails, retours Stripe) |
| `ADMIN_PASSWORD` | Mot de passe de l'admin. En production, l'admin est désactivé s'il est absent |
| `STRIPE_SECRET_KEY` | Active Stripe Checkout (sinon : mode démonstration en développement, aucun paiement en production) |
| `STRIPE_WEBHOOK_SECRET` | Vérification des webhooks |
| `RESEND_API_KEY`, `MAIL_FROM` | Envoi réel des e-mails. Sans clé : journal « outbox » consultable dans l'admin |
| `DATA_DIR` | Dossier persistant (commandes, réglages, photos importées) |

### Stripe

1. Clés API dans le tableau de bord Stripe → `STRIPE_SECRET_KEY`.
2. Webhook vers `https://votre-domaine/api/stripe/webhook`, événements :
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired` → `STRIPE_WEBHOOK_SECRET`.
3. Si le webhook tarde, la page de confirmation interroge Stripe et met la commande à jour.

Les montants envoyés à Stripe sont recalculés par le serveur à partir du catalogue :
le navigateur ne transmet que des identifiants de variante et des quantités.

---

## Architecture

```
elysea/
├── server.js                 routeur HTTP (pages, API, admin, statiques)
├── src/
│   ├── config.js             variables d'environnement
│   ├── store.js              stockage JSON atomique (interface get/set/update → migrable vers SQL)
│   ├── i18n.js               langues, routes localisées, dictionnaires
│   ├── commerce.js           prix, promotions, livraison, commandes, stock
│   ├── payments.js           mode de paiement actif
│   ├── stripe.js             Checkout (REST) + vérification de signature
│   ├── mail.js               gabarits et envoi des e-mails
│   ├── api.js                API publique
│   ├── admin.js              API d'administration + authentification
│   └── views/                layout (SEO, en-tête, pied) et pages
├── content/                  valeurs par défaut versionnées (produit, réglages, FAQ, textes FR/EN)
├── data/                     état vivant (non versionné) — créé au démarrage
├── public/
│   ├── css/  js/  fonts/  img/renders/
│   └── js/3d/                modèle procédural, scènes, viewer
├── tools/                    génération des visuels (Chromium headless + ffmpeg)
└── tests/                    intégration (node:test) et e2e (Playwright)
```

### Ajouter un coloris ou un modèle

Admin › Produit & stock › « Ajouter une variante » : nom FR/EN, couleurs de la pastille,
écart de prix, stock, photo principale. Elle apparaît immédiatement sur la fiche, dans le
panier, Stripe et les données structurées.

### Ajouter une langue

1. Ajouter le code dans `LANGS` et ses slugs dans `ROUTES` (`src/i18n.js`).
2. Ajouter le dictionnaire dans `content/texts.json`.
3. Les champs localisés de l'admin s'adaptent automatiquement.

### Remplacer le prototype 3D par le modèle réel

Admin › Photos & 3D › Modèle 3D (GLB). Nommez les nœuds `hinge` (charnière du plateau) et
`pouf` pour conserver les animations.

### Régénérer les visuels

```bash
npm run render                 # tous les plans (≈ 8 min, Chromium + ffmpeg requis)
npm run render -- hero macro   # seulement les plans dont le nom contient « hero » ou « macro »
```

Les plans sont définis dans `tools/shots.js`, les scènes dans `public/js/3d/scenes.js`.

---

## Déploiement

- **Docker** : `docker build -t elysea elysea && docker run -p 8790:8790 -v elysea-data:/data --env-file elysea/.env elysea`
- **Render** : `elysea/render.yaml` (service web + disque persistant monté sur `/data`).
- **VPS** : `node server.js` derrière nginx / Caddy (HTTPS), avec `DATA_DIR` sur un disque sauvegardé.

Sauvegardez `DATA_DIR` : il contient les commandes et les réglages.
