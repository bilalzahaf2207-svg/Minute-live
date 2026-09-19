# Minute — données réelles, en direct

Application de courses de dernière minute branchée sur des données réelles :
magasins réellement présents autour de l'utilisateur, produits avec photos et
Nutri-Score, prix relevés en magasin et datés.

---

## Ce qui est réellement en direct, et ce qui ne peut pas l'être

| Donnée | Source | En direct ? | Couverture |
|---|---|---|---|
| Magasins autour de vous (nom, position, horaires) | OpenStreetMap via Overpass | **Oui** | Excellente en France |
| Fiche produit : nom, marque, **photo**, Nutri-Score, contenance, code-barres | Open Food Facts | **Oui** | ~4 millions de produits |
| **Prix** relevés en magasin, datés, rattachés à un magasin précis | Open Prices (Open Food Facts) | **Oui** | ~314 000 relevés, **inégale** |
| Prix officiels temps réel de Lidl / Carrefour / Franprix | — | **Non** | Voir ci-dessous |

### Pourquoi aucun prix officiel d'enseigne

Aucune enseigne française n'expose d'API publique de prix. Les applications qui
en disposent (Uber Eats, Deliveroo, Instacart) signent des **contrats
commerciaux** qui leur donnent accès à un flux produits. Trois voies existent :

1. **Partenariat / affiliation** — la seule voie propre et pérenne. À demander
   au service e-commerce de chaque enseigne, ou via un agrégateur.
2. **Scraping des sites drive** — techniquement faisable, mais contraire aux
   CGU de la plupart des enseignes, bloqué par des protections anti-robot, et
   juridiquement risqué en cas d'usage commercial. Un emplacement d'adaptateur
   est prévu (`adapters/`) mais volontairement laissé vide.
3. **Données ouvertes communautaires** — Open Prices, utilisé ici. Réelles,
   datées, gratuites, légales. Couverture partielle : dense dans certaines
   villes, absente ailleurs. L'app l'indique honnêtement (« relevé le 12/09 »
   contre « prix estimé »).

### Pourquoi ça ne peut pas tourner dans un artifact Claude

Une page publiée sur claude.ai s'exécute dans un bac à sable sans aucun accès
réseau sortant : ni API, ni images distantes. Le direct exige donc un
hébergement à vous. C'est exactement ce que fait ce projet.

---

## Démarrage

```bash
cd minute-live
export MINUTE_UA="MinuteApp/1.0 (contact: vous@votredomaine.fr)"   # exigé par Open Food Facts
node server.js
# → http://localhost:8787
```

Node 18 ou plus. **Aucune dépendance npm.**

Ouvrez la page, autorisez la géolocalisation : l'app appelle `/api/catalog`,
remplace le catalogue de démonstration par les magasins et les prix réels de
votre secteur, et bascule en mode direct. Si aucun prix n'a été relevé autour
de vous, elle le dit et conserve la démonstration.

## Déploiement

Fonctionne tel quel sur Railway, Render, Fly.io, un VPS ou derrière nginx.
Seule variable obligatoire : `MINUTE_UA`. `PORT` est lu automatiquement.

```bash
# exemple VPS avec systemd
Environment=MINUTE_UA=MinuteApp/1.0 (contact: vous@votredomaine.fr)
ExecStart=/usr/bin/node /srv/minute-live/server.js
```

Pour pointer un frontend hébergé ailleurs vers l'API :
`https://votre-front/?api=https://votre-api.exemple.fr`

## API

| Route | Effet |
|---|---|
| `GET /api/health` | état du service |
| `GET /api/stores?lat=&lon=&radius=` | magasins réels autour d'un point |
| `GET /api/catalog?lat=&lon=&radius=&stores=` | **catalogue complet** : magasins + familles de produits + prix relevés |
| `GET /api/product?code=` | fiche produit + historique de prix |
| `GET /api/compare?code=&lat=&lon=` | le même code-barres, partout où il a été relevé, trié du moins cher |
| `GET /api/search?q=` | recherche produit Open Food Facts |

## Cache et politesse envers les sources

Overpass et Open Prices sont des services bénévoles. Le serveur met en cache
sur disque (`.cache/`) : magasins 24 h, prix 1 h, fiches produits 7 jours. Les
appels partent par lots de 4 à 6. **Ne supprimez pas ce cache** et ne baissez
pas les durées : un usage agressif fait bannir votre IP d'Overpass.

## Obligations de licence — ODbL

Les trois sources sont sous **Open Database License**. Si vous exploitez ce
projet, vous devez :

- afficher « Données : OpenStreetMap, Open Food Facts, Open Prices (ODbL) » ;
- republier en ODbL toute base dérivée que vous diffusez ;
- ne pas mélanger ces données avec des données non libres que vous ne pourriez
  pas relicencier ;
- contribuer en retour les produits que vous ajoutez.

Contact réutilisation : `reuse@openfoodfacts.org`.

## Suite logique

- **Contribuer les prix** : `POST /api/v1/prices` sur Open Prices permet à vos
  utilisateurs de photographier une étiquette et d'enrichir la base. C'est le
  seul moyen de faire grandir la couverture dans votre ville.
- **Partenariat enseigne** : un flux produits officiel remplacerait
  `buildCatalog()` sans toucher au reste de l'application.
- **Alerte anti-shrinkflation** : l'historique de prix d'Open Prices, croisé
  avec la contenance Open Food Facts, permet de détecter un format qui baisse
  à prix constant.
