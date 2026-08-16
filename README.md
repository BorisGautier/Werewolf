# 🐺 Werewolf Telegram Bot (`werewolf-ts`)

[![CI - Test & Quality Checks](https://github.com/BorisGautier/Werewolf/actions/workflows/ci.yml/badge.svg)](https://github.com/BorisGautier/Werewolf/actions/workflows/ci.yml)
[![CD - Production Build & Deploy](https://github.com/BorisGautier/Werewolf/actions/workflows/cd.yml/badge.svg)](https://github.com/BorisGautier/Werewolf/actions/workflows/cd.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Bot Telegram **Loup-Garou / Mafia** moderne, ultra-performant et richement animé — réécriture complète et intégrale en **Node.js / TypeScript** du projet original *Werewolf for Telegram* (C# / .NET Framework).

> **Note historique** : Le projet original C# distribué visait des milliers de serveurs simultanés en TCP. `werewolf-ts` rassemble toute cette puissance dans une **Clean Architecture monolithique** moderne, facile à héberger sur un seul VPS avec Docker, tout en étendant le jeu avec des fonctionnalités inédites (Mode Tournoi, Web Center Admin, Observabilité Grafana, 67 catégories de GIFs animés, Bilan Quotidien Slack/Mailgun).

---

## 📚 Table des Matières Documentation

| Document | Description & Contenu |
|---|---|
| 📐 [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Clean Architecture, découpage en couches, événements du domaine, schéma de base de données PostgreSQL / Prisma |
| 🎮 [`GAMEPLAY.md`](./GAMEPLAY.md) | Guide exhaustif des 63 rôles, des 10 modes de jeu, du calcul des scores, des titres et des succès |
| 🚀 [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Guide de déploiement Docker Compose, configuration Apache2 / Nginx Reverse Proxy, SSL Certbot et BotFather |
| 🧪 [`TESTING.md`](./TESTING.md) | Procédures de tests unitaires, stress-test 58+ parties, simulation bots locaux, vérifications de types et linter |

---

## 🔥 Fonctionnalités Clés & Innovations

### 🎮 1. Rôles, Équilibrage & 10 Modes de Jeu
- **63 Rôles Jouables** répartis en 7 camps (Village, Loups, Voleurs, Tanneurs, Culte, Tueurs Indépendants, Neutres).
- **Équilibrage Automatique Interne** selon la taille du village (de 5 à 35 joueurs).
- **10 Modes de Jeu Télégramme** :
  1. 🌲 `/startgame` : **Mode Normal** (Équilibré automatiquement).
  2. 🌀 `/startchaos` : **Mode Chaos** (Rôles attribués 100% aléatoirement).
  3. 🩸 `/startbloodbath` : **Bain de Sang** (Taux de tueurs maximal).
  4. 🔮 `/startdarkmagic` : **Magie Noire** (Focalisé sur la Voyante, la Sorcière, le Nécromancien).
  5. 🐺 `/startwolfpack` : **Meute de Loups** (Multiplication des rôles de loups et loups spéciaux).
  6. 🏚️ `/startcursed` : **Village Maudit** (Villageois maudits et transformations en chaîne).
  7. 🧟 `/startinfection` : **Infection** (Loup Alpha contaminateur dès la nuit 1).
  8. 💥 `/startanarchy` : **Anarchie** (Aucun timer, chaos total).
  9. ✝️ `/startholywar` : **Guerre Sainte** (Prêtresse, Archange et inquisiteurs contre cultistes).
  10. 🗡️ `/startassassins` : **Assassins** (Hitman, Tueur en Série, Vengeur et Chasseur).

---

### 🏆 2. Mode Tournoi par Équipes (`/tournoi`)
Conçu pour les compétitions inter-groupes et évènements communautaires :
- **Gestion des Équipes** : Création d'équipe (`/creerequipe <nom> <tag>`), inscription par code (`/rejoindreequipe <code>`), consultation (`/monequipe`).
- **Inscription & Appariement** : Inscription du groupe (`/inscrirefournoi <id>`), répartition intelligente des joueurs de différentes équipes dans des salons neutres.
- **Classements & Points** : Calcul automatique des points de victoire, de kill et d'objectifs de camp avec leaderboard en direct.

---

### 🎛️ 3. Admin Control Center (`https://epicwolf.borisgauty.com/admin`)
Interface d'administration Web moderne en temps réel (port `4000`) :
- 📊 **Tableau de Bord Synoptique** : Parties en cours, joueurs connectés, métriques système (CPU, RAM, Uptime).
- 🔍 **Inspecteur de Parties en Direct** : Fenêtre modale détaillant les joueurs, leurs rôles secrets, le cycle jour/nuit et la santé de la partie.
- 📢 **Diffusion d'Annonces Globale (Broadcast)** : Envoi d'annonces instantanées avec notifications Toasts.
- 💾 **Gestion des Sauvegardes DB** : Téléchargement et génération de backups PostgreSQL en un clic.
- ✅ **Modération & Approbation de Groupes** : Validation des groupes Telegram demandant à utiliser le bot.

---

### 📈 4. Observabilité Prometheus & Grafana (`https://epicwolf.borisgauty.com/grafana`)
- Endpoint métriques nativement exposé sur `/metrics` (Port `9090`).
- Dashboards Grafana préconfigurés visualisant le nombre de parties actives, la durée moyenne des nuits, la distribution des rôles distribués et les performances du serveur.

---

### 📧 5. Bilan Quotidien Automatique (Mailgun & Slack)
- **Tâche Cron Minuit (00:00 UTC)** : Synthétise automatiquement les statistiques de la journée écoulée.
- **Envoi Multi-Canal** :
  - 📩 **Email HTML enrichi via Mailgun API** (`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_TO_EMAIL`).
  - 💬 **Messages Slack Formatés via Webhook** (`SLACK_WEBHOOK_URL`).
- **Indicateurs clés** : Nombre de parties terminées, joueurs uniques, nouveaux inscrits, groupes actifs et tournois lancés.

---

### 🎬 6. Moteur Médias & 67 Catégories de GIFs Animés
- Prise en charge intégrale de **67 catégories d'événements visuels** (`StartGame`, `NightStart`, `DayStart`, `WolfAttack`, `HunterShot`, `WitchPotionKill`, `SKKilled`, `BurnToDeath`, `VillagersWin`, `WolvesWin`, `TannerWin`, `CultWins`, `SerialKillerWins`, `ArsonistWins`, `SeerVision`, `GAGuard`, `CupidLovers`, `NecromancerResurrect`, etc.).
- Prise en charge des packs de GIFs personnalisés soumis par les joueurs donateurs (`/setgif`).
- **Fallback Automatique** : Si aucun GIF n'est présent localement ou sur Telegram, le bot envoie la narration textuelle stylisée sans aucun blocage.

---

## 🤖 Liste Complète des Commandes Telegram (55+ Commandes)

À copier-coller directement dans [@BotFather](https://t.me/botfather) (`/setcommands`) :

```text
startgame - Lancer une partie classique (Mode Normal)
startchaos - Lancer une partie en Mode Chaos
startbloodbath - Lancer une partie en Mode Bain de Sang
startdarkmagic - Lancer une partie en Mode Magie Noire
startwolfpack - Lancer une partie en Mode Meute de Loups
startcursed - Lancer une partie en Mode Village Maudit
startinfection - Lancer une partie en Mode Infection
startanarchy - Lancer une partie en Mode Anarchie
startholywar - Lancer une partie en Mode Guerre Sainte
startassassins - Lancer une partie en Mode Assassins
modes - Consulter le manuel interactif des modes de jeu
join - Rejoindre la partie dans le hall
flee - Quitter la partie dans le hall
forcestart - Forcer le démarrage de la partie (Admins)
players - Afficher la liste des joueurs inscrits
addbots - Ajouter des bots dans la partie
botgame - Démarrer une partie 100% bots
extend - Prolonger le compte à rebours de recrutement
nextgame - S'inscrire automatiquement pour la prochaine partie
ping - Vérifier la réactivité et la latence du bot
config - Ouvrir le menu de configuration du groupe
rolelist - Afficher la liste des rôles de la partie
mystats - Consulter ses statistiques personnelles
stats - Afficher les statistiques globales du bot
top - Afficher le classement des meilleurs joueurs
achv - Afficher ses succès (achievements) débloqués
toptitan - Afficher le classement des Titans (Score Global)
topwin - Afficher le classement par victoires
topwolf - Afficher le classement des Meilleurs Loups
topvillager - Afficher le classement des Meilleurs Villageois
topcult - Afficher le classement des Meilleurs Cultistes
topserial - Afficher le classement des Meilleurs Tueurs en Série
toparsonist - Afficher le classement des Meilleurs Pyromanes
toptanner - Afficher le classement des Meilleurs Tanneurs
topjester - Afficher le classement des Meilleurs Bouffons
toplovers - Afficher le classement des Meilleurs Amoureux
topstreak - Afficher le classement des séries de victoires
topdaily - Afficher le classement du jour
topweekly - Afficher le classement de la semaine
topmonthly - Afficher le classement du mois
topgroup - Afficher le classement du groupe
tournoi - Menu principal du Mode Tournoi
creerequipe - Créer une équipe de tournoi
rejoindreequipe - Rejoindre une équipe avec son code
monequipe - Afficher les membres de son équipe
inscrirefournoi - Inscrire l'équipe à un tournoi actif
donate - Faire un don avec Telegram Stars
mygifs - Gérer ses packs de GIFs animés
setgif - Configurer un GIF d'événement (Donateurs)
claim - Réclamer ses récompenses quotidiennes
quests - Consulter ses quêtes quotidiennes
daily - Obtenir son bonus quotidien
language - Changer la langue du bot
help - Afficher l'aide et les règles du jeu
about - Informations sur le bot et les crédits
```

---

## 🛠️ Intégration Continue (CI/CD) & Qualité du Code

### 🧪 Pipeline CI GitHub Actions (`.github/workflows/ci.yml`)
S'exécute à chaque Pull Request et push sur `main` & `dev` :
1. **Contrôle de Types Strict** : `npx tsc --noEmit` & `npx tsc --noEmit -p tsconfig.eslint.json`.
2. **Formateur Prettier** : `npm run format:check` (vérification de la mise en forme de tout le projet).
3. **Linter ESLint** : `npm run lint`.
4. **Audit de Sécurité** : `npm audit --audit-level=high`.
5. **Suite de Tests Vitest** : 52 fichiers de tests unitaires, 577+ tests validés avec simulation stress-test de 58 parties complètes sans crash.

### 🤖 Dependabot (`.github/dependabot.yml`)
- Cible la branche **`dev`** (`target-branch: dev`).
- Analyse hebdomadaire des dépendances `npm` et `github-actions` pour proposer des mises à jour sécurisées.

### 🏷️ Pipeline CD Release (`.github/workflows/cd.yml`)
- Déclenché automatiquement par les tags de version au format **`yyyyMMdd.NumeroBuildJour`** (ex: `20260816.1`, `20260816.2`).
- Construit et publie l'image Docker de production sur GitHub Container Registry (`ghcr.io`).

---

## 🚀 Guide de Déploiement Production

### 1. Cloner et configurer l'environnement

```bash
git clone https://github.com/BorisGautier/Werewolf.git
cd Werewolf
cp .env.example .env
```

Éditer `.env` avec vos identifiants :
```env
BOT_TOKEN="8714223453:AA..."
DATABASE_URL="postgresql://werewolf:werewolf_pass@db:5432/werewolf?schema=public"
ADMIN_PASSWORD="votre_mot_de_passe_admin_securise"
JWT_SECRET="cle_secrete_jwt_robuste"
PORT=4000

# Reporting Quotidien
MAILGUN_API_KEY="key-..."
MAILGUN_DOMAIN="mg.borisgauty.com"
MAILGUN_TO_EMAIL="admin@borisgauty.com"
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

### 2. Démarrage Docker Compose

```bash
docker compose up -d --build
```

---

### 🌐 3. Configuration Apache2 Reverse Proxy + SSL Certbot

Pour exposer la plateforme sous le domaine officiel `epicwolf.borisgauty.com` :
- Admin Dashboard : `https://epicwolf.borisgauty.com/admin`
- Grafana : `https://epicwolf.borisgauty.com/grafana`

#### Créer `/etc/apache2/sites-available/epicwolf.borisgauty.com.conf` :
```apache
<VirtualHost *:80>
    ServerName epicwolf.borisgauty.com

    ProxyPreserveHost On
    ProxyRequests Off

    # Admin Control Center Web
    ProxyPass /admin http://127.0.0.1:4000/admin
    ProxyPassReverse /admin http://127.0.0.1:4000/admin

    # API Admin Server
    ProxyPass /api/admin http://127.0.0.1:4000/api/admin
    ProxyPassReverse /api/admin http://127.0.0.1:4000/api/admin

    # Grafana Dashboards
    ProxyPass /grafana/ http://127.0.0.1:3000/
    ProxyPassReverse /grafana/ http://127.0.0.1:3000/
</VirtualHost>
```

#### Activer et certifier avec Certbot SSL :
```bash
sudo a2enmod proxy proxy_http headers rewrite ssl
sudo a2ensite epicwolf.borisgauty.com.conf
sudo systemctl reload apache2
sudo certbot --apache -d epicwolf.borisgauty.com
```

---

## 🏗️ Architecture du Code

```text
src/
├── application/         # Orchestration des cas d'usage (GameManager)
├── domain/              # Cœur Métier Pure (63 rôles, agrégat Game, victoires, gazette)
│   ├── achievements/    # Catalogue & évaluateur de 100+ succès
│   ├── game/            # Moteur de jeu (phases, nuits, lynch, équilibrage)
│   ├── roles/           # Bitmasks et définitions des rôles
│   └── scoring/         # Calcul des rangs, de l'XP et des points
└── infrastructure/      # Adaptateurs IO & Techniques
    ├── cron/            # Tâches planifiées & Daily Summary
    ├── monitoring/      # Serveur de métriques Prometheus
    ├── notifications/   # Expéditeur Mailgun Email & Slack Webhook
    ├── persistence/     # Repositories Prisma PostgreSQL
    ├── telegram/        # Bot grammY, commandes, menus & GameLoop
    └── web/             # Serveur HTTP Web Admin Dashboard & Authentification JWT
```

---

## 🧪 Développement & Vérifications Locales

```bash
# Lancer la suite de tests unitaires Vitest (577 tests)
npm test

# Auto-formater le code avec Prettier
npm run format

# Vérifier la mise en forme du code avec Prettier
npm run format:check

# Vérifier la compilation TypeScript
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.eslint.json

# Lancer le linter ESLint
npm run lint
```

---

## 📄 Licence
Projet sous licence [MIT](LICENSE). Développé avec passion pour offrir l'expérience Loup-Garou Telegram la plus aboutie au monde ! 🐺✨
