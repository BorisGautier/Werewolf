# 🐺 werewolf-ts

Bot Telegram **Loup-Garou / Mafia** — réécriture complète en **Node.js / TypeScript**
du projet original [Werewolf for Telegram](https://github.com/) (C# / .NET Framework),
pensée pour tourner en un seul service Docker sur un VPS personnel.

> Ce dossier contient le port complet. Le projet C# original vit dans
> `../Werewolf for Telegram/` et n'est conservé que comme référence historique —
> il n'est plus déployé.

## Table des matières de la documentation

| Document | Contenu |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Clean architecture, couches, flux d'événements, schéma de base de données, décisions techniques |
| [`GAMEPLAY.md`](./GAMEPLAY.md) | Déroulement d'une partie, les camps, le détail des 43 rôles, les options de configuration |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Créer le bot sur Telegram (BotFather) et le déployer sur un VPS avec Docker |
| [`TESTING.md`](./TESTING.md) | Tout ce qu'on peut tester en local (unitaire, typecheck, lint, build, base de données, bot réel) |

## Pourquoi une réécriture (et pas un simple port 1:1)

Le projet original était conçu pour un opérateur gérant potentiellement des
milliers de groupes Telegram en simultané : il utilise une architecture
distribuée `Control` (routeur Telegram) / `Node` (moteur de jeu), plusieurs
process qui se parlent en TCP, avec auto-scaling. Pour un usage personnel sur
un seul VPS, cette complexité n'apporte rien et complique inutilement la
maintenance.

`werewolf-ts` garde **la même richesse fonctionnelle** — 43 rôles, équilibrage
automatique des parties, cycles jour/nuit/vote complets, configuration fine
par groupe, statistiques, plus de 100 succès (achievements), dons via
Telegram Stars — mais dans **un seul service monolithe**, organisé en couches
propres (clean architecture), plus simple à comprendre, tester et faire
évoluer.

## Fonctionnalités

- **43 rôles jouables** répartis en 6 camps (Village, Loups, Voleur, Tanneur,
  Culte, Tueur en série, Incendiaire), avec équilibrage automatique de la
  composition de partie selon le nombre de joueurs (voir `GAMEPLAY.md`).
- **Deux modes de jeu** : `Normal` (équilibré automatiquement) et `Chaos`
  (composition aléatoire, aucune garantie d'équilibre).
- **Configuration par groupe** (`/config`, menu à boutons en message privé) :
  activer/désactiver chaque rôle individuellement, régler les timers de
  jour/nuit/vote/prolongation, la taille max de partie, le vote secret, le
  mode d'affichage des rôles en fin de partie, la langue du groupe, etc.
- **Plus de 100 succès (achievements)** débloqués automatiquement selon les
  actions effectuées en partie, consultables avec `/achv`.
- **Dons via Telegram Stars** (`/donate`) débloquant des badges affichés à
  côté du nom du joueur et l'accès aux packs de GIFs personnalisés.
- **Système de GIFs personnalisés** par joueur donateur, avec file de
  validation par les administrateurs du bot.
- **i18n complet FR/EN**, formulations aléatoires pour éviter la répétition,
  système extensible à d'autres langues et à plusieurs "packs" par langue.
- **Modération complète** : bans temporaires/permanents globaux, ban de
  groupe persistant, détection anti-spam automatique avec bannissement
  progressif, admins anonymes de groupe pris en charge.
- **Outils d'administration bot** : profils joueurs, transferts de succès,
  mode maintenance, informations d'usage serveur, mise à jour à chaud.
- **Tâches planifiées (cron)** : agrégation de statistiques quotidiennes,
  levée automatique des bans temporaires expirés, purge des parties
  abandonnées suite à un crash/redéploiement.

## Architecture en un coup d'œil

```
src/
  domain/            <- logique métier pure, zéro dépendance IO/framework
    roles/             - catalogue des 43 rôles (bitmask, emoji, camp)
    game/               - moteur de jeu : phases, résolution de nuit, vote, victoire
    achievements/       - catalogue et évaluateur des succès
    shared/             - utilitaires purs (shuffle, ...)
  application/        <- cas d'usage / orchestration
    game-manager.ts     - registre en mémoire des parties en cours
  infrastructure/     <- tout ce qui touche à l'extérieur
    persistence/         - repositories Prisma / PostgreSQL
    telegram/             - bot grammy : commandes, menus, boucle de partie
    i18n/                 - chargement et traduction des fichiers de langue
    cron/                 - tâches planifiées (node-cron)
    config/               - chargement/validation des variables d'environnement (zod)
    logging/              - logger structuré (pino)
  main.ts             <- composition root : assemble tout et démarre le bot
```

Détails complets dans [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Démarrage rapide (développement local)

```bash
cp .env.example .env
# renseigner BOT_TOKEN (voir DEPLOYMENT.md) et éventuellement DATABASE_URL

npm install
docker compose up -d db        # démarre juste Postgres
npm run prisma:deploy          # applique les migrations existantes
npm run dev                    # démarre le bot en mode watch (tsx)
```

Guide complet, y compris sans Docker (Postgres local natif) et sans jamais
toucher à un vrai bot Telegram : voir [`TESTING.md`](./TESTING.md).

Autres commandes utiles :

```bash
npm run lint            # ESLint
npm run test            # Vitest (tests unitaires — domaine, infra, i18n...)
npm run build            # compilation TypeScript -> dist/
npm run prisma:studio    # explorateur de données Prisma (GUI web)
npm run prisma:migrate   # crée une nouvelle migration après modification du schéma
```

## Déploiement en production

Guide détaillé pas à pas (création du bot via BotFather, configuration du
`.env`, `docker compose up -d --build`, mise à jour, sauvegarde de la base) :
voir [`DEPLOYMENT.md`](./DEPLOYMENT.md).

Résumé : le bot tourne en *long polling* (pas besoin de nom de domaine ni de
certificat HTTPS) dans un conteneur `app`, avec PostgreSQL dans un conteneur
`db` séparé et un volume nommé pour la persistance. Au démarrage, le conteneur
applique automatiquement les migrations Prisma avant de lancer le bot.

## Prérequis

- Node.js 20+
- Docker + Docker Compose (déploiement, ou pour lancer juste Postgres en local)
- Un token de bot Telegram ([@BotFather](https://t.me/BotFather))

## État du projet

Le moteur de jeu, les 43 rôles, l'ensemble des commandes Telegram, les succès,
les dons, la modération et l'i18n FR/EN sont implémentés et couverts par une
suite de tests unitaires (485 tests). Voir l'audit de stabilité le plus
récent partagé en conversation pour le détail des vérifications effectuées
(typecheck, lint, tests, build, migrations de base de données, image Docker)
et les quelques limites connues et assumées (pas d'environnement Telegram
réel disponible pour un test de bout en bout, quelques mécaniques annotées
"best effort" dans le code).
