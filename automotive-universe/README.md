# AUTOMOTIVE UNIVERSE — agent TikTok autonome

Agent de production indépendant (serveur cloud) pilotable depuis l'app Claude sur iPhone.
**Lire d'abord [ARCHITECTURE.md](ARCHITECTURE.md)** : fonctionnement, coûts, limites et décisions à valider.

## Essai local (gratuit, simulation)

```bash
cd automotive-universe
cp .env.example .env        # puis renseigner ADMIN_TOKEN et MCP_PATH_SECRET (24+ caractères)
npm start                   # Node 22.5+, ffmpeg requis
# http://localhost:8080  → tableau de bord
AGENT_URL=http://localhost:8080 AGENT_TOKEN=<ADMIN_TOKEN> node bin/agentctl.js "Prépare les vidéos de demain"
npm test
```

Par défaut : `PUBLISH_MODE=dry_run` (rien n'est envoyé à TikTok), `LLM_PROVIDER=none`
(aucune IA payante), `BUDGET_MONTHLY_EUR=0` (aucune dépense possible).
