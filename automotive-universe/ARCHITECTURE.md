# AUTOMOTIVE UNIVERSE — Architecture Claude Pro + iPhone + agent TikTok autonome

> État au 24/11/2026. **Rien de payant n'a été déployé ni activé.** Le code fonctionne
> aujourd'hui en mode simulation à 0 €. Les décisions qui demandent votre accord sont
> regroupées en fin de document (section F).

---

## 1. Principe : deux mondes séparés

```
 ┌───────────────────────── VOUS (iPhone) ──────────────────────────┐
 │                                                                  │
 │  App Claude (abonnement Pro)              Safari / écran d'accueil│
 │  ├─ Discussion + connecteur « Agent »     └─ Tableau de bord mobile│
 │  └─ Onglet Code (sessions cloud)             (jeton admin)       │
 └──────┬─────────────────────┬───────────────────────┬─────────────┘
        │ MCP (outils listés) │ agentctl (HTTPS)      │ HTTPS
        ▼                     ▼                       ▼
 ┌──────────────── SERVEUR CLOUD (indépendant de Claude) ───────────┐
 │  Agent de production — Node 22, un seul processus                │
 │  ├─ Planificateur interne (recherche, production, publication,   │
 │  │  statistiques, mémoire, bilan hebdo)                          │
 │  ├─ Mémoire : SQLite sur disque (sujets, vidéos, stats, journaux,│
 │  │  dépenses, enseignements)                                     │
 │  ├─ Montage : ffmpeg (+ voix locale Piper en option)             │
 │  ├─ Garde-fou budgétaire (plafond mensuel, alertes, gel)         │
 │  └─ Liste blanche de commandes (rien d'autre n'est pilotable)    │
 └──────┬──────────────────────┬────────────────────────┬───────────┘
        │ OAuth officiel        │ clé API séparée        │ push
        ▼                       ▼ (optionnelle)          ▼
   API TikTok             API Anthropic            ntfy → iPhone
```

- **Claude Code (votre abonnement Pro)** sert à **construire, maintenir et faire évoluer** le
  système, et à le **piloter** quand vous le souhaitez.
- **L'agent de production** tourne seul sur un serveur, 24 h/24, avec son propre moteur,
  sa mémoire, ses planifications et ses connexions. Fermer l'app Claude, éteindre
  l'iPhone ou l'ordinateur n'interrompt rien (exigences B et E).

Le code se trouve dans `automotive-universe/` (dans ce dépôt pour l'instant, faute d'un dépôt
dédié ; il peut être déplacé dans un dépôt privé `automotive-universe` à tout moment).

---

## A. Connexion à votre compte Claude

| Usage | Comment | Coût |
|---|---|---|
| Claude Code sur iPhone | App Claude → onglet **Code** : sessions cloud sur ce dépôt GitHub, connectées à votre compte Pro existant | Inclus dans Pro (limites d'usage partagées avec claude.ai) |
| Claude Code sur ordinateur | `claude` puis `/login` avec le **même** compte Claude — pas de deuxième compte, pas de clé API | Inclus dans Pro |
| Remote Control | Seulement si une tâche a besoin de **votre** ordinateur (fichiers locaux, logiciel installé). Pour ce projet, les sessions cloud suffisent : ce n'est pas nécessaire au quotidien | Inclus |
| Discussion Claude sur iPhone | Connecteur personnalisé « Automotive Universe » (voir D) | Inclus dans Pro |

Règles respectées :

- aucun mot de passe ni cookie Claude n'est stocké, nulle part ;
- le serveur **n'utilise jamais** votre abonnement Pro : faire tourner un automate permanent
  sur un abonnement grand public reviendrait à contourner ses conditions et ses limites ;
- les secrets (jeton d'administration, clé API éventuelle) sont dans le `.env` du serveur, et
  pour les sessions Claude Code dans les **secrets réseau de l'environnement cloud**
  (injectés par le proxy, jamais collés dans la discussion).

## B. Exécution autonome dans le cloud

Le planificateur interne (`src/scheduler.js`) exécute, en heure de Paris :

| Heure | Tâche | Payant ? |
|---|---|---|
| 06:15 | Recherche de sujets (bibliothèque de fiches + flux RSS ; IA si budget) | Non par défaut |
| 18:10 | Préparation des vidéos du lendemain : sujet → script → montage → planification | Non par défaut |
| toutes les 5 min | Publication des vidéos arrivées à échéance (3 essais, puis alerte) | Non |
| 23:20 | Collecte des statistiques TikTok et mise à jour des enseignements | Non |
| 03:40 | Entretien de la mémoire (purge des journaux de plus de 90 jours) | Non |
| lundi 08:05 | Bilan hebdomadaire envoyé sur l'iPhone | Non |

Surveillance des erreurs : chaque échec est enregistré, consultable à distance
(`explain_failures`) et déclenche une notification push. Un battement de cœur est écrit
chaque minute ; le conteneur a une sonde de santé (`/health`) pour redémarrage automatique.

**Mémoire** : un fichier SQLite (`data/agent.db`) contient sujets, vidéos, statistiques,
journaux, dépenses et enseignements (`insights.best_slots_utc`, `insights.best_series`),
utilisés pour choisir les séries qui performent le mieux.

## C. Gestion des coûts

### Ce que Claude Pro couvre — et ce qu'il ne couvre pas

- **Couvre** : vos conversations, Claude Code (ordinateur, web, iPhone), l'utilisation du
  connecteur de l'agent depuis l'app. Dans les limites d'usage de l'abonnement.
- **Ne couvre pas** : l'API Anthropic. Un serveur autonome qui appelle Claude a besoin d'une
  **clé API** créée sur console.anthropic.com, **facturée séparément, à l'usage**.

### Trois niveaux, au choix

| Niveau | IA côté serveur | Qualité des vidéos | Coût IA / mois* |
|---|---|---|---|
| **0 — Sans IA** (actif par défaut) | Aucune. Scripts générés à partir de fiches rédigées pendant vos sessions Claude Code (abonnement Pro), importées avec `agentctl import` | Bonne si les fiches sont bonnes ; l'agent ne crée pas de nouveaux sujets seul (hors RSS) | **0 €** |
| **1 — Claude Haiku 5.5** (0,10 $ / 0,50 $ par million de jetons) | Scripts, idées, séries | Correcte | **< 0,50 €** |
| **2 — Claude Sonnet 5.5** (2 $ / 10 $) | Idem | Très bonne | **≈ 2 à 4 €** |
| **3 — Claude Opus 5.5** (4 $ / 20 $) — modèle configuré par défaut dès que l'IA est activée | Idem | Meilleure | **≈ 3 à 7 €** |

\* Estimation pour 2 vidéos/jour (≈ 60 scripts + 30 recherches/mois), effort « low »,
marge incluse. Les tarifs API sont en dollars ; conversion configurable (`USD_TO_EUR`).
D'autres fournisseurs moins chers pourraient être branchés dans `src/llm.js` ; je ne l'ai pas
fait, Haiku 5.5 étant déjà quasi gratuit à ce volume.

Tout le reste est **sans IA** : montage ffmpeg, planification, publication, statistiques,
compréhension des demandes simples du tableau de bord (analyse de mots-clés en français).

### Garde-fous (`src/budget.js`)

1. **Plafond mensuel en euros** — `0 €` par défaut : **aucune dépense n'est possible**.
2. Avant **chaque** appel payant, le coût du pire cas (jetons maximum × tarif × marge de 1,5)
   est comparé au reste du mois ; si ça dépasse, l'appel n'a pas lieu et l'agent continue
   en mode gratuit.
3. Le coût réel (jetons facturés) est enregistré après chaque appel.
4. Alertes push à 50 %, 80 % et 100 % du plafond.
5. Bouton de **gel** des dépenses.
6. Le plafond ne peut être modifié que par vous, depuis l'API d'administration, avec la phrase
   exacte « JE CONFIRME 15 EUR ». **Ni l'agent, ni l'app Claude, ni Claude Code via le
   connecteur ne peuvent l'augmenter** : la commande n'existe pas dans la liste blanche.
7. Double sécurité recommandée : fixer aussi une **limite de dépense dans la console Anthropic**.

## D. Pilotage depuis l'iPhone

### 1) Dans l'app Claude — connecteur personnalisé (recommandé)

L'agent expose un serveur MCP. Une fois ajouté (claude.ai → Paramètres → Connecteurs →
Ajouter un connecteur personnalisé → `https://<votre-agent>/mcp/<MCP_PATH_SECRET>`), il est
disponible dans l'app iPhone et vous écrivez naturellement ; Claude choisit l'outil :

| Vous dites | Outil appelé |
|---|---|
| « Prépare les vidéos de demain. » | `prepare_videos` |
| « Pourquoi la publication de ce matin a échoué ? » | `explain_failures` |
| « Analyse les performances de la semaine. » | `weekly_report` |
| « Prépare une série sur les moteurs V12. » | `plan_series` (+ `import_series` : Claude peut rédiger les fiches lui-même dans la discussion, **sur votre abonnement Pro**, puis les importer, sans coût API) |
| « Consulte les messages privés en attente. » | `pending_messages` (voir limites) |
| « Mets en pause les publications. » | `pause_publishing` / `resume_publishing` |

Il y a aussi `status`, `budget_status` (lecture seule) et `run_research`.

### 2) Dans l'onglet Code — `agentctl`

Dans une session cloud sur ce dépôt : `node automotive-universe/bin/agentctl.js "Prépare les vidéos de demain"`.
Le jeton est fourni par un secret réseau de l'environnement cloud (le proxy l'ajoute aux
requêtes vers votre serveur). C'est aussi là que Claude Code fait évoluer le code.

### 3) Tableau de bord mobile sécurisé

`https://<votre-agent>/` — à ajouter à l'écran d'accueil (Partager → Sur l'écran d'accueil).
Indicateurs, prochaines vidéos, journal, boutons Préparer / Échecs / Semaine / Pause,
champ de demande libre. Protégé par jeton (comparaison à temps constant, blocage après
20 échecs en 10 min), HTTPS obligatoire en production.

### 4) Notifications push

Application gratuite **ntfy** sur l'iPhone, abonnée à un sujet privé (nom long et aléatoire) :
échecs, budget, sujets insuffisants, bilan du lundi.

## E. Indépendance de l'agent

| Composant | Où il vit | Dépend de Claude Code ? |
|---|---|---|
| Moteur d'exécution + planificateur | Serveur cloud | Non |
| Mémoire (SQLite) | Disque persistant du serveur | Non |
| Connexion TikTok (jetons OAuth) | Serveur (`data/tokens.json`, droits 600) | Non |
| IA (optionnelle) | API Anthropic, clé du serveur | Non |
| Évolution du code | Dépôt GitHub, via Claude Code | Oui — volontairement |

Les tâches planifiées de Claude Code ne sont **pas** utilisées pour la production.

## F. Règle de sécurité — ce qu'il faut valider avant toute dépense

### Fournisseurs, coûts et limites

| Poste | Option recommandée | Coût estimé | Alternatives | Limites |
|---|---|---|---|---|
| **Serveur** | Hetzner Cloud CX22 (2 vCPU, 4 Go, UE) + Caddy (HTTPS gratuit) | ≈ 4 à 6 €/mois (+ ≈ 1 € pour les sauvegardes) | Render (worker + disque, ≈ 7 à 9 $/mois, aucune administration) ; Railway (≈ 5 $/mois et plus) | VPS : mises à jour système à votre charge (automatisables) |
| Nom de domaine | Optionnel | ≈ 10 €/an | Sous-domaine fourni par Render ; tunnel Cloudflare gratuit | — |
| IA serveur | Niveau 0 | 0 € | Haiku / Sonnet / Opus 5.5 (voir C) | Clé API facturée à part de Pro |
| Voix off | Piper (local) | 0 € | ElevenLabs (payant) | Voix Piper moins naturelle |
| Images et vidéos | Pexels / Pixabay (licence libre), vos propres photos | 0 € | Banques payantes | **Jamais** de contenus repris d'autres comptes ou de chaînes (droits d'auteur) |
| Alertes | ntfy | 0 € | Webhook, courriel | — |
| TikTok | API officielle (compte développeur) | 0 € | — | Voir ci-dessous |
| **Total minimum** | | **≈ 5 à 7 €/mois** | | |

### Limites TikTok (à revérifier lors de l'inscription, la plateforme les fait évoluer)

- **Publication** : API Content Posting via une application développeur TikTok et OAuth.
  Tant que l'application n'est **pas auditée** par TikTok, les publications sont **privées**
  (visibles par vous seul) : vous les passez en public dans l'app TikTok. L'audit demande une
  politique de confidentialité, des conditions d'utilisation et une démonstration.
- **Quota** de publications par compte et par jour.
- **Messages privés** : pas d'API publique générale de lecture. L'agent ne se connectera
  **jamais** avec votre identifiant, mot de passe ou cookies, et n'automatisera pas
  l'application. La commande répond honnêtement que la fonction n'est pas disponible.
- **Statistiques** : vues, j'aime, commentaires et partages de vos propres vidéos.
- **Qualité** : TikTok favorise le contenu original ; des diaporamas texte seul percent peu.
  Ajouter vos propres images et la voix off améliore nettement les résultats. Un contenu
  réaliste généré par IA doit être signalé comme tel.

Vous restez propriétaire de tout : compte TikTok, application développeur TikTok, compte
d'hébergement, clé API Anthropic, dépôt GitHub et base de données, **tous à votre nom**.
L'agent n'a que des jetons révocables.

### Décisions demandées

1. **Hébergeur** : Hetzner (≈ 5 €/mois, recommandé) ou Render (≈ 8 $/mois, sans administration) ?
2. **IA côté serveur** : rester au niveau 0, ou ouvrir un budget (je propose **15 €/mois**
   au maximum, avec Haiku 5.5 ou Sonnet 5.5) ?
3. **Créer l'application développeur TikTok** (gratuit, à faire par vous avec votre compte) ?
4. **Nom de domaine** : oui ou non ?

Sans réponse, rien n'est engagé. Le code reste en simulation (`PUBLISH_MODE=dry_run`,
`LLM_PROVIDER=none`, `BUDGET_MONTHLY_EUR=0`).

---

## Feuille de route

| Phase | Contenu | Coût |
|---|---|---|
| 0 — **fait** | Agent complet, tests, simulation de bout en bout (montage réel en 1080×1920) | 0 € |
| 1 | Déploiement du serveur en simulation + connecteur Claude + ntfy | Hébergeur (après accord) |
| 2 | Application TikTok + OAuth + publication réelle en privé | 0 € |
| 3 | Budget IA (si accord) | Selon plafond |
| 4 | Audit TikTok → publication publique automatique | 0 € |
| 5 | OAuth sur le connecteur MCP (à la place de l'URL secrète), sauvegardes chiffrées hors serveur | ≈ 1 €/mois |

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/server.js` | API admin, tableau de bord, MCP, OAuth TikTok, démarrage |
| `src/scheduler.js` | Planificateur interne |
| `src/budget.js` | Plafond, alertes, gel, confirmation du propriétaire |
| `src/llm.js` | Routeur IA (aucune IA / API Anthropic), contrôle du budget avant chaque appel |
| `src/commands.js` | Liste blanche des commandes + compréhension simple du français |
| `src/mcp.js` | Connecteur pour l'app Claude et Claude Code |
| `src/pipeline/*` | Recherche, script, montage, publication, statistiques, production |
| `src/adapters/tiktok.js` | API TikTok officielle (OAuth, publication, statistiques) |
| `public/dashboard.html` | Tableau de bord mobile |
| `bin/agentctl.js` | Pilotage en ligne de commande |
| `data/series.json` | Bibliothèque de fiches (série « Moteurs V12 » d'exemple) |
| `.env.example` | Toute la configuration, valeurs sûres par défaut |
