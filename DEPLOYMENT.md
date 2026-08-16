# Déploiement

Guide pas à pas pour créer le bot sur Telegram puis le déployer sur un VPS
avec Docker. Le bot tourne en *long polling* : il n'a besoin d'aucun nom de
domaine, certificat HTTPS ou port entrant ouvert — il se contente d'appeler
l'API Telegram vers l'extérieur, ce qui suffit largement pour un usage
personnel ou un groupe de communauté.

## 1. Créer le bot sur Telegram (BotFather)

1. Ouvre une conversation avec [@BotFather](https://t.me/BotFather) sur
   Telegram.
2. Envoie `/newbot` et suis les instructions : choisis un nom d'affichage
   puis un nom d'utilisateur se terminant par `bot` (ex. `MonLoupGarouBot`).
3. BotFather te renvoie un **token** au format `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
   C'est ta valeur `BOT_TOKEN` — garde-la secrète, elle donne un contrôle
   total du bot.
4. (Optionnel mais recommandé) toujours avec BotFather :
   - `/setprivacy` → `Disable` sur ton bot, sinon il ne recevra **aucun**
     message de groupe qui n'est pas une commande qui lui est explicitement
     adressée (indispensable pour les votes et menus du jeu).
   - `/setjoingroups` → `Enable` pour pouvoir l'ajouter à des groupes.
   - `/setcommands` pour publier la liste des commandes dans le menu Telegram
     (`/help` donne la liste complète une fois le bot démarré, mais publier
     un sous-ensemble ici facilite la découverte).
5. Ajoute le bot au(x) groupe(s) où il doit jouer, et **promeus-le
   administrateur** du groupe (il a besoin de pouvoir épingler des messages
   et de lire tous les messages selon la configuration de confidentialité).

### Récupérer ton identifiant Telegram (pour `DEV_USER_IDS`)

Les commandes de développement (`/bangroup`, `/maintenance`, `/update`, ...)
ne sont accessibles qu'aux identifiants listés dans `DEV_USER_IDS`. Pour
connaître ton id numérique Telegram, parle à [@userinfobot](https://t.me/userinfobot)
(ou lance simplement le bot une fois et utilise `/whois <ton_pseudo>` une
fois qu'un premier dev est configuré, ou consulte les logs du premier
`/start`).

## 2. Préparer le VPS

Prérequis sur le serveur :

- Un VPS Linux (1 vCPU / 1 Go de RAM suffisent largement pour un usage
  personnel — le bot et Postgres sont légers).
- Docker Engine + le plugin Docker Compose (`docker compose version` doit
  fonctionner). Voir la [doc officielle Docker](https://docs.docker.com/engine/install/)
  pour ta distribution.
- Git pour cloner le dépôt (ou un simple transfert de fichiers).

```bash
# Exemple sur Debian/Ubuntu
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # puis se reconnecter
```

## 3. Cloner et configurer

```bash
git clone <url-du-depot>
cd Werewolf

cp .env.example .env
nano .env   # ou vim/éditeur de ton choix
```

Renseigne dans `.env` :

| Variable | Description | Exemple |
|---|---|---|
| `BOT_TOKEN` | Token obtenu via BotFather (étape 1) | `123456789:AAE...` |
| `POSTGRES_PASSWORD` | Mot de passe de la base Postgres du conteneur `db` (choisis-en un fort) | `un-mot-de-passe-genere-aleatoirement` |
| `DEV_USER_IDS` | Tes identifiants Telegram numériques, séparés par des virgules, autorisés aux commandes dev | `123456789,987654321` |
| `ERROR_CHAT_ID` | (optionnel) id d'un chat/groupe privé où le bot peut remonter des erreurs | `-1001234567890` |
| `LOG_LEVEL` | Niveau de log (`info` recommandé en prod, `debug` pour investiguer) | `info` |

> `DATABASE_URL` n'a **pas** besoin d'être renseignée dans `.env` pour un
> déploiement Docker Compose standard : `docker-compose.yml` la construit
> automatiquement à partir de `POSTGRES_PASSWORD` et pointe vers le conteneur
> `db`. Ne renseigne `DATABASE_URL` toi-même que si tu utilises une base
> Postgres externe (managée, autre VPS...).

## 4. Démarrer

```bash
docker compose up -d --build
```

Ce que fait cette commande :

1. Construit l'image `app` (build multi-étapes : installation des
   dépendances, compilation TypeScript, génération du client Prisma, puis
   image finale minimale avec uniquement les dépendances de production).
2. Démarre le conteneur `db` (Postgres 16) avec un volume nommé
   `werewolf-db-data` pour que les données survivent aux redémarrages/mises
   à jour.
3. Attend que Postgres réponde (`healthcheck` `pg_isready`) avant de démarrer
   `app`.
4. Au démarrage du conteneur `app`, `docker-entrypoint.sh` exécute
   automatiquement `prisma migrate deploy` (applique les migrations de base
   de données présentes dans `prisma/migrations/`) **avant** de lancer le
   bot — aucune commande manuelle de migration n'est nécessaire lors d'un
   premier déploiement.

Vérifier que tout tourne :

```bash
docker compose ps
docker compose logs -f app
```

Tu dois voir dans les logs, dans l'ordre :

```
Running database migrations...
... (sortie de `prisma migrate deploy`)
Starting werewolf-ts...
{"level":30,...,"msg":"Connected to database"}
{"level":30,...,"msg":"Achievement catalog seeded"}
{"level":30,...,"msg":"Bot initialized", "username":"MonLoupGarouBot"}
{"level":30,...,"msg":"Cron jobs started"}
{"level":30,...,"msg":"werewolf-ts is running (long polling)"}
```

À ce stade, le bot répond dans Telegram : teste avec `/ping` dans un chat
privé avec lui, puis `/startgame` dans un groupe où il est admin.

## 5. Mettre à jour après un `git pull`

```bash
git pull
docker compose up -d --build
```

Docker Compose reconstruit uniquement l'image `app` (le cache Docker évite
de tout recompiler si seul le code source a changé) et redémarre le
conteneur. Le conteneur `db` n'est pas touché — les données persistent dans
le volume `werewolf-db-data`. Si de nouvelles migrations Prisma ont été
ajoutées au dépôt, elles sont appliquées automatiquement au redémarrage
(même mécanisme qu'à l'étape 4).

## 6. Sauvegarder / restaurer la base de données

Sauvegarde :

```bash
docker compose exec db pg_dump -U werewolf werewolf > backup-$(date +%Y%m%d).sql
```

Restauration (sur une base vide) :

```bash
cat backup-20260101.sql | docker compose exec -T db psql -U werewolf werewolf
```

Pense à automatiser une sauvegarde régulière (cron sur l'hôte, ou service de
snapshot de ton hébergeur) — le volume Docker seul ne te protège pas d'une
corruption de données, seulement d'une suppression accidentelle du
conteneur.

## 7. Arrêter / redémarrer

```bash
docker compose stop        # arrête sans supprimer les conteneurs
docker compose start       # redémarre
docker compose restart app # redémarre uniquement le bot (garde la base active)
docker compose down        # supprime les conteneurs (le volume de données est conservé)
```

⚠️ `docker compose down -v` supprime aussi le **volume** — donc toutes les
données de la base. Ne l'utilise jamais sans une sauvegarde récente.

## 8. Dépannage

**Le bot ne répond à rien dans un groupe.** Vérifie que le mode
confidentialité (`/setprivacy`) est bien sur `Disable` chez BotFather, et que
le bot est administrateur du groupe.

**`docker compose logs -f app` s'arrête juste après "Running database
migrations..." avec une erreur Prisma.** Vérifie que `POSTGRES_PASSWORD`
dans `.env` correspond bien à celui utilisé par le conteneur `db` (si tu
changes ce mot de passe après le premier démarrage, l'ancien volume garde
l'ancien mot de passe côté Postgres — il faut soit remettre l'ancienne
valeur, soit recréer le volume).

**Erreur `BOT_TOKEN is required` ou `DATABASE_URL is required` au
démarrage.** Le fichier `.env` n'est pas chargé ou une variable manque —
relis l'étape 3 (`.env.example` liste toutes les variables reconnues, voir
`src/infrastructure/config/env.ts` pour le détail de leur validation).

**Je veux changer de VPS / migrer.** Sauvegarde la base (étape 6), copie le
dépôt (avec ton `.env`) sur le nouveau serveur, restaure la sauvegarde après
le premier `docker compose up -d --build` (ou avant, peu importe l'ordre tant
que la restauration se fait avant que le bot ne commence à écrire).

## 9. Aller plus loin

- `LOG_LEVEL=debug` dans `.env` puis `docker compose up -d` pour des logs
  plus verbeux le temps d'investiguer un souci.
- `docker compose exec app npx prisma studio` (puis rediriger le port 5555
  via un tunnel SSH) pour explorer la base de données avec une interface
  graphique sans exposer Postgres publiquement.
- Voir [`ARCHITECTURE.md`](./ARCHITECTURE.md) pour comprendre l'organisation
  du code si tu comptes modifier ou étendre le bot, et
  [`TESTING.md`](./TESTING.md) pour développer/tester en local avant de
  redéployer.

## 9. Configuration Web Server Apache2 & Nginx (`epicwolf.borisgauty.com`)

Pour accéder au Control Center Admin et à Grafana sous le même nom de domaine :
- **Admin App** : `https://epicwolf.borisgauty.com/admin`
- **Grafana** : `https://epicwolf.borisgauty.com/grafana`

### Option A : Serveur Web Apache2 (Recommandé avec Certbot)

1. Activer les modules Apache nécessaires :
   ```bash
   sudo a2enmod proxy proxy_http headers rewrite ssl
   ```
2. Créer le VirtualHost `/etc/apache2/sites-available/epicwolf.borisgauty.com.conf` :
   ```apache
   <VirtualHost *:80>
       ServerName epicwolf.borisgauty.com

       ProxyPreserveHost On
       ProxyRequests Off

       # Admin Control Center Web
       ProxyPass /admin http://127.0.0.1:4000/admin
       ProxyPassReverse /admin http://127.0.0.1:4000/admin

       ProxyPass /api/admin http://127.0.0.1:4000/api/admin
       ProxyPassReverse /api/admin http://127.0.0.1:4000/api/admin

       # Grafana Dashboards
       ProxyPass /grafana/ http://127.0.0.1:3000/
       ProxyPassReverse /grafana/ http://127.0.0.1:3000/
   </VirtualHost>
   ```
3. Activer le site et générer le certificat SSL Let's Encrypt avec Certbot :
   ```bash
   sudo a2ensite epicwolf.borisgauty.com.conf
   sudo systemctl reload apache2
   sudo certbot --apache -d epicwolf.borisgauty.com
   ```

### Option B : Serveur Web Nginx

```nginx
server {
    listen 80;
    server_name epicwolf.borisgauty.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name epicwolf.borisgauty.com;

    ssl_certificate /etc/letsencrypt/live/epicwolf.borisgauty.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/epicwolf.borisgauty.com/privkey.pem;

    location /admin {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/admin/ {
        proxy_pass http://localhost:4000/api/admin/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /grafana/ {
        proxy_pass http://localhost:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 10. Ajouter des GIFs de mort/victoire

### Il n'y a rien à « récupérer » du projet original

Le système de GIFs existe dans le code (menus, base de données, envoi) mais
**ne contient aucun média par défaut**, et ce n'est pas un oubli de ce
portage : le projet C# original ne livrait lui non plus **aucun GIF
intégré au dépôt**. `CustomGifData` (`Werewolf Node/Models/CustomGifData.cs`
dans le code source original) n'y stocke que des chaînes `file_id`
Telegram, jamais des fichiers — c'était une fonctionnalité **payante,
réservée aux donateurs** (`Want to help keep Werewolf Moderator online?
Donate now and gets: Custom gifs`, `Werewolf Control/Commands/GifCommands.cs`),
soumise par chaque utilisateur puis validée manuellement par un développeur.

Concrètement, même en ayant un accès total à la base de données de
l'instance originale, ses `file_id` ne fonctionneraient pas sur ton bot :
un `file_id` Telegram est **propre au bot qui l'a reçu** — il n'est pas
portable d'un token de bot à un autre. Il n'existe donc aucun jeu de GIFs
« d'origine » à copier ; il faut en soumettre de nouveaux à ton instance,
avec le workflow ci-dessous (déjà entièrement fonctionnel, il suffit de
l'utiliser).

### Méthode A (recommandée) : GIFs par défaut, aucune commande

Dépose directement tes fichiers dans `assets/gifs/` (voir le
[`README.md`](./assets/gifs/README.md) de ce dossier pour la convention de
nommage exacte, ex. `VillagerDie.mp4`, `WolvesWin.mp4`) puis redéploie
(`git pull && docker compose up -d --build`, voir §5) — pas de compte
donateur, pas de `/setgif`, pas d'approbation à faire : `sendGifForEvent`
(`game-loop.ts`) envoie automatiquement le fichier trouvé pour chaque
catégorie dès qu'il existe. Un pack de groupe ou de joueur approuvé (méthode
B ci-dessous) reste prioritaire sur ce fichier par défaut si les deux
existent.

### Méthode B : workflow donateur (`/setgif`), pour laisser tes joueurs personnaliser

Utile si tu veux que différents groupes/joueurs aient chacun leurs propres
GIFs plutôt qu'un seul jeu par défaut pour toute l'instance.

1. **Débloque la fonctionnalité pour toi-même** (normalement réservée aux
   donateurs, mais il existe un contournement dev prévu pour ça — même
   esprit que `/addach`) : en PM avec le bot,
   ```
   /adddonation TON_ID_TELEGRAM 10
   ```
   (ton id doit être dans `DEV_USER_IDS` — voir §1). `10` correspond au
   premier palier de don, celui qui débloque les GIFs personnalisés.

2. **Envoie un GIF ou une vidéo au bot** en PM (glisse-dépose ou transfère
   un fichier `.gif`/`.mp4` que tu as déjà), puis **réponds à ce message**
   avec :
   ```
   /setgif <catégorie>
   ```
   Catégories disponibles (une soumission par catégorie, répète l'étape
   pour chacune que tu veux personnaliser) :
   `VillagerDie`, `WolfWin`, `WolvesWin`, `VillagersWin`, `NoWinner`,
   `StartGame`, `StartChaosGame`, `TannerWin`, `CultWins`,
   `SerialKillerWins`, `LoversWin`, `SKKilled`, `ArsonistWins`,
   `BurnToDeath`. `/customgif` affiche à tout moment ton avancement
   (combien de catégories déjà remplies).

3. **Valide ta propre soumission** (commande dev) :
   ```
   /reviewgifs              # liste les packs en attente
   /approvegifs TON_ID_TELEGRAM
   ```

4. **Active le pack dans un groupe** — un admin du groupe (ou toi si tu
   l'es) y exécute :
   ```
   /usegifpack TON_ID_TELEGRAM
   ```
   `/usegifpack none` désactive le pack du groupe.

Dans les deux cas, le bot envoie automatiquement l'animation correspondante
en plus du message texte habituel (mort de nuit, victoire, etc.) — aucune
autre configuration nécessaire.
