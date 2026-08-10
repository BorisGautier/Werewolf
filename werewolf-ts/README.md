# werewolf-ts

Réécriture du bot Telegram [Werewolf for Telegram](../Werewolf%20for%20Telegram) (C#/.NET Framework)
en **Node.js / TypeScript**, en architecture propre (clean architecture),
pensée pour tourner sur un VPS personnel via Docker.

> Ce dossier vit dans la branche `claude/werewolf-nodejs-migration`, à côté du
> projet C# original (conservé comme référence tant que la migration n'est
> pas terminée).

## Pourquoi une réécriture (et pas juste un port 1:1)

Le projet original était conçu pour un opérateur gérant des milliers de
groupes Telegram simultanément : il utilise donc une architecture distribuée
`Control` (routeur Telegram) / `Node` (moteur de jeu), plusieurs process qui
se parlent en TCP, avec auto-scaling. Sur un VPS personnel, cette complexité
n'apporte rien. `werewolf-ts` garde donc **la même richesse fonctionnelle**
(43 rôles, équilibrage automatique, cycles jour/nuit/vote, config par groupe,
stats, achievements) mais dans **un seul service** organisé en couches, plus
simple à comprendre, tester et faire évoluer.

## Architecture (clean architecture)

```
src/
  domain/           <- logique métier pure, zéro dépendance IO/framework
    roles/           - catalogue des 43 rôles (bitmask, emoji, etc.)
    game/             - équilibrage des rôles, modes de jeu, teams, kill methods
    config/           - règles de configuration de groupe
  application/       <- cas d'usage qui orchestrent le domaine + les "ports"
    ports/             - interfaces (repository, gateway Telegram, horloge...)
    services/
  infrastructure/    <- implémentations concrètes des ports
    persistence/       - Prisma/PostgreSQL
    telegram/           - bot grammy, commandes
    i18n/               - chargement des fichiers de langue + traduction
    scheduler/          - cron jobs (node-cron)
    config/             - chargement/validation des variables d'env (zod)
    logging/            - logger (pino)
  main.ts            <- composition root : assemble tout et démarre le bot
```

Règle de dépendance : `domain` ne dépend de rien d'autre. `application` ne
dépend que de `domain` (via des ports/interfaces). `infrastructure` implémente
ces ports et est le seul endroit qui connaît Prisma, grammy, etc. `main.ts`
est le seul fichier qui "branche" les implémentations concrètes.

## État d'avancement

| Bloc | Statut |
|---|---|
| Squelette projet (TS strict, ESLint, Prettier, Vitest) | ✅ |
| Domaine : rôles (43), équilibrage automatique, modes de jeu | ✅ testé |
| Schéma base de données (Prisma/PostgreSQL) | ✅ |
| Docker (Dockerfile multi-stage + docker-compose) | ✅ |
| i18n (FR/EN, formulations aléatoires, système extensible) | ✅ testé (jeu de clés de démarrage, pas encore la parité totale avec les ~1000 clés de `English.xml`) |
| Bot Telegram : bootstrap (long polling, `/ping`, `/version`, gestion d'erreurs) | ✅ |
| Bot Telegram : commandes de jeu/admin/dev complètes | ⏳ à venir |
| Moteur de jeu (state machine jour/nuit/vote, 43 rôles) | ⏳ à venir |
| Cron jobs (rotation de stats, purge des parties mortes, bans) | ⏳ à venir |
| CI (GitHub Actions) | ⏳ à venir |

Le moteur de jeu (~6000 lignes dans l'original) et le jeu complet de
commandes sont volontairement traités comme des chantiers à part, pour être
portés (et testés) morceau par morceau plutôt que d'un bloc.

## Prérequis

- Node.js 20+
- Docker + Docker Compose (pour le déploiement / pour lancer Postgres en local)
- Un token de bot Telegram ([@BotFather](https://t.me/BotFather))

## Développement local

```bash
cp .env.example .env
# renseigner BOT_TOKEN et DATABASE_URL dans .env

npm install
docker compose up -d db        # démarre juste Postgres
npm run prisma:migrate         # applique le schéma
npm run dev                    # démarre le bot en mode watch
```

Autres commandes utiles :

```bash
npm run lint       # ESLint
npm run test       # Vitest (tests unitaires du domaine, i18n, ...)
npm run build       # compilation TypeScript -> dist/
npm run prisma:studio  # explorateur de données Prisma
```

## Déploiement sur ton VPS (Docker)

1. Sur le VPS : installer Docker + Docker Compose plugin.
2. Cloner le repo, se placer dans `werewolf-ts/`.
3. Créer un `.env` à partir de `.env.example` avec ton vrai `BOT_TOKEN`, un
   `POSTGRES_PASSWORD` fort, et éventuellement `DEV_USER_IDS`/`ERROR_CHAT_ID`.
4. Démarrer :

   ```bash
   docker compose up -d --build
   ```

   Au démarrage, le conteneur `app` applique automatiquement les migrations
   Prisma (`prisma migrate deploy`) avant de lancer le bot
   (`docker-entrypoint.sh`). Postgres tourne dans son propre conteneur avec
   un volume nommé (`werewolf-db-data`) pour la persistance.
5. Suivre les logs : `docker compose logs -f app`.
6. Mettre à jour après un `git pull` : `docker compose up -d --build`.

Le bot tourne en *long polling* (pas besoin d'un nom de domaine ni de
certificat HTTPS pour le VPS) - suffisant pour un usage personnel. On pourra
passer en mode webhook plus tard si besoin de scaler.

## Prochaines étapes (roadmap)

1. Porter le moteur de jeu (`Werewolf.cs`) : state machine Day/Lynch/Night,
   logique de chacun des 43 rôles, conditions de victoire.
2. Porter l'ensemble des commandes (`Werewolf Control/Commands/*.cs`) avec
   `grammy` : jeu (`/startgame`, `/join`, ...), admin de groupe (`/config`,
   `/smite`, ...), modération globale (bans, dev commands).
3. Cron jobs : rotation des statistiques agrégées, purge des parties
   abandonnées, expiration des bans temporaires.
4. Étendre le jeu de langues au-delà de FR/EN si besoin.
5. CI GitHub Actions (lint + tests + build sur chaque PR).
