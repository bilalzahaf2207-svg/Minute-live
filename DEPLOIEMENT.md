# Mettre Minute en ligne — sans terminal, sans Git

Environ 10 minutes. Deux comptes gratuits à créer (GitHub, Render).
Aucun identifiant à partager avec qui que ce soit.

---

## Étape 1 — Déposer le code sur GitHub (3 min)

1. Crée un compte sur **github.com** si tu n'en as pas.
2. Clique **+** en haut à droite → **New repository**.
3. Nom : `minute-live`. Laisse **Public**. Clique **Create repository**.
4. Sur la page qui s'affiche : **uploading an existing file**.
5. Dézippe `minute-live.zip` sur ton ordinateur, puis **glisse tout le
   contenu du dossier** (pas le dossier lui-même) dans la zone de dépôt.

   Tu dois voir arriver : `server.js`, `package.json`, `render.yaml`,
   `Dockerfile`, `railway.json`, `README.md`, et le dossier `public/`
   contenant `index.html` et `live.js`.
6. Clique **Commit changes**.

> Sur téléphone, le glisser-déposer ne marche pas : fais cette étape sur
> un ordinateur. Le reste fonctionne sur mobile.

## Étape 2 — Déployer sur Render (5 min)

1. Va sur **render.com** → **Get Started** → **Sign in with GitHub**.
2. Autorise Render à lire tes dépôts.
3. Tableau de bord → **New +** → **Web Service**.
4. Sélectionne le dépôt `minute-live` → **Connect**.
5. Render lit `render.yaml` et remplit tout seul le build et le démarrage.
   **Ne change rien**, sauf :
   - **Instance Type** : choisis **Free**
   - **Environment Variables** : Render demande `MINUTE_UA`.
     Mets exactement, avec ton vrai email :
     ```
     MinuteApp/1.0 (contact: ton@email.fr)
     ```
     C'est obligatoire : Open Food Facts bloque les requêtes anonymes.
6. **Create Web Service**. Attends que le journal affiche
   `MINUTE — serveur de données réelles`.

Ton adresse apparaît en haut : `https://minute-live-xxxx.onrender.com`

## Étape 3 — Vérifier

Ouvre `https://ton-adresse.onrender.com/api/health`
→ tu dois voir `{"ok":true,...}`

Puis ouvre la racine `https://ton-adresse.onrender.com`, autorise la
géolocalisation. Un bandeau bleu annonce la recherche, puis :

- **bandeau vert** — données réelles chargées, nombre de magasins et de
  familles de produits affiché ;
- **bandeau rouge « aucun prix relevé dans ce secteur »** — les magasins
  réels sont là, mais Open Prices n'a pas encore de relevés chez toi.
  Ce n'est pas une panne : c'est la couverture de la base. Voir plus bas.

---

## À savoir sur l'offre gratuite Render

Le service s'endort après 15 minutes sans visite. La première ouverture
suivante prend 30 à 50 secondes. C'est normal, ce n'est pas un bug.

## Si ta zone n'a aucun prix relevé

Open Prices est alimentée par des contributeurs. Trois options :

1. **Contribuer** — crée un compte sur `prices.openfoodfacts.org`,
   photographie des étiquettes dans ton magasin. Les prix apparaissent
   immédiatement dans ton app.
2. **Élargir le rayon** — dans `live.js`, passe `radius=2500` à `8000`.
3. **Accepter le mode estimé** — l'app continue de fonctionner et marque
   honnêtement chaque prix non relevé comme « prix estimé ».

## Alternative sans GitHub

Railway et Render savent aussi déployer depuis une image Docker. Le
`Dockerfile` est fourni et fonctionne tel quel si tu préfères cette voie.
