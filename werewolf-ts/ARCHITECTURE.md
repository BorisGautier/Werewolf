# Architecture

Ce document explique comment le code est organisé, pourquoi, et les patterns
récurrents qu'on retrouve partout dans le projet. Il complète
[`README.md`](./README.md) (vue d'ensemble) et [`GAMEPLAY.md`](./GAMEPLAY.md)
(règles du jeu) avec le "comment c'est câblé".

## 1. Vue d'ensemble : clean architecture à 3 couches

```
src/
  domain/            <- logique métier PURE. Zéro import de Prisma, grammy, fs, réseau...
  application/        <- orchestration légère au-dessus du domaine
  infrastructure/     <- tout ce qui touche l'extérieur (DB, Telegram, fichiers, horloge système)
  main.ts             <- composition root
```

**Règle de dépendance** : `domain` ne dépend de rien d'autre dans `src/`.
`application` ne dépend que de `domain`. `infrastructure` peut dépendre des
deux. `main.ts` est le seul fichier qui construit les implémentations
concrètes (client Prisma, bot grammy, etc.) et les assemble.

Contrairement à une "clean architecture" à la lettre, il n'y a **pas**
d'interfaces `Port`/`Gateway` séparées entre `application` et
`infrastructure` : chaque repository (`PlayerRepository`, `GroupRepository`,
...) est une classe concrète directement injectée dans le bot via l'objet
`BotDependencies` (`src/infrastructure/telegram/bot.ts`). Ce projet n'a
qu'une seule implémentation réelle de chaque repository (Prisma/PostgreSQL)
et aucun besoin identifié d'en substituer une autre — ajouter une couche
d'interfaces n'apporterait que de l'indirection sans bénéfice pratique. Les
tests d'infrastructure (`test/infrastructure/*.test.ts`) mockent directement
ces classes avec de simples objets `vi.fn()`, ce qui suffit largement.

## 2. `domain/` — le cœur du jeu

Aucune fonction ici ne fait d'I/O, n'importe `Date.now()` sans le recevoir en
paramètre injectable, ni ne connaît Telegram ou la base de données. Tout est
testable en pur unitaire, sans mock.

```
domain/
  roles/role.ts            - catalogue des 43 rôles : bitmask (Role = bigint),
                              emoji, camp par défaut, "peut être désactivé"
  game/
    game.aggregate.ts        - la classe Game : state machine centrale
                                (Joining -> Night -> Day -> Lynch -> ... -> Ended)
    game-balancing.ts        - algorithme de tirage/équilibrage des rôles
    game-mode.ts              - 'Normal' | 'Chaos'
    game-phase.ts              - énumération des phases
    night-resolution.ts        - résolution de nuit rôle par rôle (43 rôles)
    night-visit.ts              - mécanique générique "qui visite qui" (Catin, GA...)
    day-actions.ts               - capacités à bouton de jour (Maire, Pacifiste...)
    clairvoyance.ts                - Voyante/Sorcier/Bouffon/Oracle/Augure
    lynch.ts                        - dépouillement du vote de lynchage
    kill.ts                          - pipeline de mort + réactions en chaîne
                                        (chasseur qui tire, amoureux qui meurt de chagrin...)
    role-changes.ts                   - promotions de rôle (Traître -> Loup, Apprenti -> Voyante...)
    transform.ts                       - vol de rôle (Voleur), Doppelgänger
    win-condition.ts                    - CheckForGameEnd : qui a gagné ?
    team.ts                              - mapping rôle -> camp
    kill-method.ts                        - énumération des causes de mort
    player.ts                             - le type Player et ses champs mécaniques
    player-query.ts                        - petits helpers de recherche (findById...)
    game-event.ts                          - LE type union GameEvent (voir section 3)
  achievements/
    catalog.ts               - définition des ~102 succès (code, condition narrative)
    evaluate.ts               - évaluateur : quels succès un joueur vient-il de débloquer ?
  shared/shuffle.ts         - Fisher-Yates pur (utilisé par le tirage des rôles)
```

`Game` (`game.aggregate.ts`) est l'agrégat central : il possède la liste des
joueurs, la phase courante, et expose des méthodes comme `start()`,
`startNight()`, `resolveNightActions()`, `resolveLynch()`,
`checkWinCondition()`. Chacune de ces méthodes qui change l'état du jeu
**retourne un tableau de `GameEvent`** plutôt que d'envoyer des messages
elle-même — c'est le point clé de toute l'architecture (section suivante).

## 3. Le pattern central : `GameEvent[]` (event-sourcing léger)

Le domaine ne sait pas parler à Telegram, et ne devrait pas avoir à le
savoir : ce serait mélanger "que se passe-t-il dans la partie" et "comment
l'annoncer, dans quelle langue, à qui". La séparation se fait via un type
union `GameEvent` (`domain/game/game-event.ts`, une soixantaine de variantes)
:

```ts
type GameEvent =
  | { type: 'PlayerDied'; playerId: bigint; method: KillMethod; ... }
  | { type: 'GuardianAngelSaved'; gaId: bigint; targetId: bigint }
  | { type: 'ChemistPoisoned'; chemistId: bigint; targetId: bigint }
  | { type: 'PlayerFrozen'; playerId: bigint; cause: 'SnowWolf'; snowWolfId: bigint; flavor: FreezeFlavor }
  // ... ~60 variantes au total
```

Flux complet d'une résolution de nuit :

```
GameLoop.runNight()
  └─ game.resolveNightActions()          [domain, pur]
       └─ retourne GameEvent[]
  └─ pour chaque event : messages.describeEvent(event, players, showRolesOnDeath)
       └─ retourne OutgoingMessage[] = { audience: 'group' | bigint, key, args }[]
  └─ GameLoop.broadcast(...)              [infrastructure]
       └─ translator.translate(lang, key, ...args) -> texte final
       └─ bot.api.sendMessage(...) au bon chat/joueur
```

`describeEvent` (`infrastructure/telegram/messages.ts`) est la **seule**
fonction qui sait transformer un événement en texte. Elle choisit la bonne
clé i18n, le ou les destinataires (`'group'` pour un message public, un
`bigint` — l'id Telegram du joueur — pour un message privé), et les
arguments à interpoler. Certains événements sont volontairement silencieux
(pas de texte, juste un changement d'état interne suivi ailleurs), documenté
en commentaire en tête du fichier.

Pourquoi ce détour plutôt que d'envoyer les messages directement depuis
`night-resolution.ts` ? Trois raisons concrètes, pas juste "c'est plus
propre" :

1. **Testabilité** : chaque résolveur de nuit se teste en asserting sur le
   tableau de `GameEvent` retourné, sans mock de bot Telegram ni de
   traducteur (`test/domain/night-resolution.*.test.ts`).
2. **i18n centralisée** : ajouter une langue ou reformuler un message ne
   touche que `messages.ts` + les fichiers de locale, jamais la logique de
   jeu.
3. **Achievements côté événements** : `achievements/evaluate.ts` consomme
   les mêmes `GameEvent[]` pour détecter les conditions de déblocage
   (`GameLoop.awardAchievements`), sans dupliquer la détection.

### `FreezeFlavor` : un exemple du piège "état capturé trop tard"

Certains événements doivent figer une information au moment exact de leur
émission, parce que l'état du jeu qui la détermine change avant que le
message ne soit construit. Exemple : quand le Loup des Neiges gèle un
joueur, le texte que reçoit la victime dépend de son rôle réel *au moment du
gel* (Alchimiste, Catin, Fossoyeur ayant déjà creusé une tombe cette
nuit-là...). Si on recalculait ce "flavor" plus tard dans `messages.ts`,
l'état (nombre de tombes creusées, réglage `ThiefFull`...) pourrait avoir
changé entre-temps. `night-resolution.ts` calcule donc un
`FreezeFlavor` (type énuméré) et le fige directement dans l'événement
`PlayerFrozen` au moment de l'émission — `messages.ts` n'a plus qu'à
mapper ce flavor déjà tranché vers la bonne clé i18n
(`FREEZE_FLAVOR_KEY`). Ce pattern "figer la nuance au moment de l'émission,
pas au moment du rendu" revient pour plusieurs autres événements (Ange
Gardien, Chimiste).

## 4. `application/` — orchestration légère

```
application/game-manager.ts   - GameManager : registre EN MÉMOIRE des parties
                                 en cours (Map<chatId, Game>). Pas de persistance :
                                 si le process redémarre, les parties en cours sont
                                 perdues (rattrapé par purgeStaleGames en cron, voir
                                 section 6).
```

Volontairement minimal : la vraie orchestration (timers de phase, envoi des
menus, callbacks de boutons) vit dans `infrastructure/telegram/game-loop.ts`
parce qu'elle est indissociable de Telegram (grammy `InlineKeyboard`,
`ctx.api.sendMessage`...). La séparer artificiellement en une couche
"application" pure aurait ajouté une indirection sans réel gain de
testabilité : `game-loop.ts` est déjà testé via un harnais qui mocke l'objet
`bot` (`test/infrastructure/game-loop.test.ts`).

## 5. `infrastructure/` — le monde extérieur

```
infrastructure/
  persistence/
    prisma-client.ts        - singleton du client Prisma (connect/disconnect)
    player.repository.ts     - joueurs : profil, langue, dons, badge donateur
    group.repository.ts       - groupes : config, rôles activés/désactivés, langue
    game.repository.ts         - parties : création, clôture, stats, getPlayerStats
    admin.repository.ts         - admins globaux + bans (voir BanScope)
    achievement.repository.ts    - catalogue + déblocages persistés
    gif-pack.repository.ts        - packs de GIFs personnalisés par joueur/groupe
    notify-game.repository.ts      - liste d'attente /nextgame
    mappers.ts                      - conversions ligne Prisma <-> type domaine
  telegram/
    bot.ts                  - composition des commandes (grammy), point d'entrée
                               de toutes les commandes /xxx (voir GAMEPLAY.md pour
                               la liste complète)
    game-loop.ts              - le chef d'orchestre : timers de phase, envoi des
                                 menus (clavier inline), dispatch des callbacks de
                                 boutons, broadcast des GameEvent, achievements
    game-lobby.ts               - lobby avant démarrage (/join, /players, /flee...)
    config-menu.ts                - menu /config (boutons inline, paginé)
    messages.ts                     - describeEvent (section 3)
    death-messages.ts                - variantes de messages de mort ("mort en visitant")
    end-game-summary.ts               - récapitulatif de fin de partie
    role-info.ts                       - texte des commandes /about<rôle>
    role-menus.ts                       - claviers inline de sélection de cible
    moderation-targets.ts                - résolution d'une cible de modération
                                            (réponse à un message, @mention, id numérique)
    spam-guard.ts                         - détection de flood + ban progressif
  i18n/
    locale-loader.ts        - charge locales/*.json au démarrage
    translator.ts             - Translator.translate(lang, key, ...args), formulations
                                 aléatoires (tableau de variantes par clé)
    locale-file.types.ts       - typage du format de fichier de locale
  cron/
    jobs.ts                  - les 3 tâches (voir section 6), pures/testables
    scheduler.ts               - branchement node-cron (cadence de chaque tâche)
  config/env.ts             - schéma zod des variables d'environnement (voir DEPLOYMENT.md)
  logging/logger.ts          - logger pino structuré (JSON)
main.ts                     - composition root : construit tout, démarre le bot + les crons
```

## 6. Tâches planifiées (cron)

Trois tâches, chacune une fonction pure `(prisma, logger) => Promise<void>`
testée indépendamment de sa cadence (`test/infrastructure/cron-jobs.test.ts`),
branchées sur une cadence réelle dans `scheduler.ts` :

| Tâche | Cadence | Rôle |
|---|---|---|
| `rotateDailyStats` | tous les jours à 00:05 UTC | agrège les parties terminées de la veille en une ligne `DailyStat` par groupe |
| `expireBans` | toutes les minutes | lève les bans temporaires (spam) dont `expiresAt` est dépassé |
| `purgeStaleGames` | toutes les heures (à :30) | marque `endedAt` sur les parties orphelines de plus de 12h (process crashé/redéployé en cours de partie) |

La cadence "toutes les minutes" d'`expireBans` n'est pas arbitraire : elle
reproduit le comportement du `BanMonitor` original (un thread qui se
réveille chaque minute), pour que même le palier de ban le plus court (12h,
premier niveau de l'anti-spam) ne reste jamais bloqué inutilement longtemps
après son expiration.

## 7. Base de données (Prisma / PostgreSQL)

Schéma dans `prisma/schema.prisma`, 14 tables. Vue d'ensemble des entités
principales :

- **`Player`** — un joueur Telegram connu du bot : profil (nom, username,
  langue), état de ban, compteurs cross-parties utilisés par les succès
  (`guardianAngelSaves`, `firstLynchStreak`...), dons (`totalDonatedStars`,
  `donationLevel`).
- **`Group`** — un groupe Telegram où le bot joue : toute la config
  (`/config`) — rôles désactivés, timers, mode de jeu, vote secret, taille
  max, langue —, plus `banned` (ban de groupe persistant, `/bangroup`).
- **`Game`** / **`GamePlayer`** / **`GameKill`** — une partie jouée, ses
  participants (avec `won: boolean`), et le détail de chaque mort (pour les
  succès et les stats).
- **`Achievement`** / **`PlayerAchievement`** — catalogue des succès et
  déblocages par joueur.
- **`GlobalBan`** — bans globaux, avec `scope` (`SPAM` auto vs `MANUAL`
  admin) et `expiresAt` nullable (`null` = permanent).
- **`AdminUser`** — grants d'administration globale (`DEV` / `GLOBAL_ADMIN`).
- **`CustomGifPack`** — pack de GIFs personnalisés d'un joueur donateur.
- **`NotifyGame`** — liste d'attente `/nextgame`.
- **`DailyStat`** — rollup quotidien (section 6).
- **`GroupDisabledRole`** — rôles désactivés par groupe (relation many-to-many
  matérialisée plutôt qu'un bitmask en base, pour rester requêtable).

Voir [`DEPLOYMENT.md`](./DEPLOYMENT.md) pour comment les migrations
(`prisma/migrations/`) sont appliquées automatiquement au démarrage du
conteneur, et [`TESTING.md`](./TESTING.md) pour en créer une nouvelle après
avoir modifié le schéma.

## 8. i18n

`locales/en.json` et `locales/fr.json`, toujours tenus en parité stricte
(une clé manquante dans l'un des deux est un bug). Chaque clé peut mapper
soit une chaîne unique, soit un tableau de variantes — dans ce cas
`Translator.translate` en tire une au hasard à chaque appel, pour éviter que
le bot répète mot pour mot le même message à chaque partie. Les
interpolations utilisent une syntaxe positionnelle `{0}`, `{1}`, ... résolue
par `translate(lang, key, ...args)`.

## 9. Points d'entrée et démarrage (`main.ts`)

Ordre de démarrage (voir `main.ts`) :

1. Charger et valider `.env` (`loadEnv`, échoue vite si `BOT_TOKEN` ou
   `DATABASE_URL` manquent).
2. Se connecter à Postgres (`prisma.$connect()`) — échec rapide si la base
   est injoignable plutôt que démarrer un bot à moitié fonctionnel.
3. Charger les locales.
4. Semer le catalogue d'achievements en base (`achievementRepository.seed()`
   — idempotent, upsert par code).
5. Construire le bot (`createBot`) avec toutes les dépendances concrètes.
6. `bot.init()` (résout `botInfo` via l'API Telegram), puis démarrer le
   *runner* de long polling (`@grammyjs/runner`).
7. Démarrer les tâches cron.
8. Gestion propre de `SIGINT`/`SIGTERM` : arrête les crons, arrête le
   runner, déconnecte Prisma, puis quitte.

## 10. Tests

Vitest, ~485 tests, aucune vérification de type pendant l'exécution des
tests (transpile-only) — c'est pourquoi `npx tsc -p tsconfig.eslint.json
--noEmit` (qui inclut `test/**/*.ts`, contrairement au `tsconfig.json` de
build qui ne couvre que `src/`) doit toujours être lancé en plus de
`vitest run` : une erreur de type dans une fixture de test ne serait sinon
détectée par rien. Détail complet dans [`TESTING.md`](./TESTING.md).
