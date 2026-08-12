# Prérequis (Requirements)

Ce document liste **tout ce qu'il faut réunir** pour que le bot tourne
correctement en production, et distingue explicitement ce qui a été
**vérifié automatiquement** (tests, build, migration appliquée sur une
vraie base) de ce qui **n'a jamais été testé en conditions réelles**
(interaction avec l'API Telegram, partie jouée par de vrais humains). Pour
la procédure d'installation pas à pas, voir [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## 1. Compte et objet Telegram

| Élément | Obligatoire ? | Détail |
|---|---|---|
| Compte Telegram personnel | Oui | Pour parler à [@BotFather](https://t.me/BotFather) et récupérer ton id (`DEV_USER_IDS`). |
| Bot créé via BotFather (`BOT_TOKEN`) | Oui | `/newbot` → token au format `123456789:AAE...`. |
| `/setprivacy` → `Disable` | Oui | Sans ça, le bot ne reçoit **aucun** message de groupe qui n'est pas une commande qui lui est directement adressée — les votes en groupe et menus ne fonctionneraient pas. |
| `/setjoingroups` → `Enable` | Oui, si le jeu se joue en groupe | Nécessaire pour ajouter le bot à un groupe. |
| Bot promu **administrateur** du groupe | Oui | Il doit pouvoir épingler des messages et lire tous les messages du groupe. |
| Groupe Telegram avec au moins 5 membres actifs | Oui pour jouer | `minPlayers` est fixé à **5** par défaut dans le moteur de jeu (`game.aggregate.ts`), configurable par groupe jusqu'à `maxPlayers` (35 par défaut, ajustable via `/config`). En dessous de 5 joueurs, `/forcestart` refuse de démarrer la partie. |

## 2. Serveur / infrastructure

| Élément | Obligatoire ? | Détail |
|---|---|---|
| VPS ou machine Linux avec Docker Engine + Docker Compose plugin | Oui (méthode recommandée) | 1 vCPU / 1 Go RAM suffisent pour un usage personnel/communautaire. |
| Accès réseau sortant vers `api.telegram.org` | Oui | Le bot tourne en **long polling** — pas besoin de nom de domaine, HTTPS entrant, ni port ouvert. |
| PostgreSQL 16 | Oui | Fourni automatiquement par `docker-compose.yml` (conteneur `db`) ; possibilité d'utiliser une base externe managée en renseignant `DATABASE_URL` soi-même. |
| Espace disque pour le volume `werewolf-db-data` | Oui | Croît avec le nombre de joueurs/parties ; usage typique très faible (texte uniquement, pas de médias stockés en base). |
| Stratégie de sauvegarde (`pg_dump` régulier) | Fortement recommandé | Aucune sauvegarde automatique n'existe dans le projet — voir §6 de `DEPLOYMENT.md`. |

## 3. Variables d'environnement (`.env`)

Copiées depuis `.env.example`, validées au démarrage par
`src/infrastructure/config/env.ts` (le process **refuse de démarrer** si
une variable obligatoire manque ou est invalide) :

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `BOT_TOKEN` | **Oui** | — | Token BotFather. Sans lui, échec immédiat au démarrage. |
| `DATABASE_URL` | **Oui** | — | Auto-construite par `docker-compose.yml` si tu utilises Compose ; à fournir toi-même sinon. |
| `POSTGRES_PASSWORD` | Recommandé | `werewolf` | Mot de passe Postgres du conteneur `db` — change la valeur par défaut en prod. |
| `DEV_USER_IDS` | Non | vide | Id Telegram numériques autorisés aux commandes dev (`/maintenance`, `/update`, `/bangroup`, etc.). Sans ça, **personne** ne peut exécuter ces commandes. |
| `ERROR_CHAT_ID` | Non | vide | Chat où le bot remonte ses erreurs internes. |
| `LOG_LEVEL` | Non | `info` | `debug` utile en investigation. |
| `NODE_ENV` | Non | `production` en Docker | Ne pas mettre `development` en prod (active des comportements de dev). |

## 4. Ce qui a été vérifié automatiquement (fiable)

- ✅ Compilation TypeScript stricte (`npm run build`) sans erreur.
- ✅ Lint (`eslint`) sans erreur sur `src/` et `test/`.
- ✅ 494/494 tests unitaires verts (`npm test`), couvrant le moteur de jeu,
  les 43 rôles, l'i18n, les achievements, la modération, etc.
- ✅ **11 600 parties complètes simulées de bout en bout**
  (`test/simulation/full-game-stress.test.ts`, `SIM_SCALE=200`) selon **6
  stratégies de vote** différentes (aléatoire, vote unanime, égalité
  forcée, abstention totale, vote ciblé sur le Tanner, vote ciblé sur le
  Prince) — pas juste des clics indépendants au hasard, qui ne
  reproduisent jamais un vrai groupe qui se coordonne. Rôles distribués
  via le même algorithme d'équilibrage qu'en production, tailles de 5 à 35
  joueurs (le maximum réel), chaque menu nuit/jour/vote répondu via le même
  point d'entrée qu'un vrai clic Telegram (`GameLoop.handleCallback()`).
  Résultat : **0 crash, 0 partie bloquée, 100 % des 11 600 parties
  terminées sur un camp vainqueur valide**, avec les **9 camps gagnants
  possibles** tous observés (Village, Loups, Tanner, Culte, Tueur en
  série, Incendiaire, Amoureux, Aucun gagnant, Chasseur-vs-dernier-Loup)
  et 4 des 6 issues de vote (Lynché, Aucun vote, Maire épargné par le
  Pacifiste, Prince survit) — les 2 restantes (Égalité, Victoire du Tanner
  par lynchage) sont prouvées séparément par deux scénarios déterministes
  dédiés qui forcent la composition de rôles exacte plutôt que d'espérer
  que le hasard y tombe. Cette campagne a trouvé et corrigé **deux vrais
  bugs** pendant cet audit (voir plus bas) — la preuve que ce test a une
  vraie valeur, pas juste une case cochée.
- ✅ Migration Prisma initiale générée et **appliquée avec succès sur une
  vraie base PostgreSQL 16 vide** via `prisma migrate deploy` (la commande
  exacte lancée par `docker-entrypoint.sh`) — un déploiement neuf crée
  correctement les 14 tables.
- ✅ Démarrage réel du process Node contre cette base migrée : connexion
  DB, seed des 102 succès (`achievements`), sans erreur.
- ✅ Parité complète des clés de traduction FR/EN (397 clés, aucune
  manquante des deux côtés).

### Deux vrais bugs trouvés et corrigés grâce à la simulation

**Bug 1 — le tir final du Chasseur plantait le bot.** La toute première
campagne de simulation a fait planter le bot en 15 parties : quand un
Chasseur (`Hunter`) meurt lors d'un tour de vote qui décide *en même
temps* la victoire (ex. le lynchage tranche aussi le camp gagnant), le
moteur terminait la partie et proposait le tir final du Chasseur dans le
même lot d'événements — le code qui traite ce tir essayait alors de tuer
sur une partie déjà terminée et plantait (`GameError: The game has
already ended`, dans `game-loop.ts`). Corrigé (`handleHunterShots`
reconnaît maintenant ce cas et laisse le gestionnaire normal de fin de
partie s'en occuper).

**Bug 2 — une victoire du Tanner par lynchage n'arrêtait jamais la
partie.** Trouvé en construisant délibérément un scénario pour forcer
cette victoire précise (composition de rôles imposée, groupe qui vote
unanimement pour le Tanner à chaque tour) plutôt que d'attendre que le
hasard y tombe — ce scénario a échoué **30 fois sur 30** avant le correctif.
Cause : quand le Tanner est lynché, le code qui décide « la partie
est-elle finie ? » (`checkWinCondition`) n'avait **aucune branche pour
reconnaître une victoire du Tanner** — cette victoire est décidée ailleurs
(`resolveLynchVotes`), qui marque bien les gagnants et annonce « le Tanner
gagne ! », mais sans jamais faire passer l'état réel de la partie à
« terminée ». Concrètement : le bot aurait annoncé la victoire du Tanner
**puis enchaîné sur une nouvelle nuit** comme si de rien n'était,
contredisant sa propre annonce. Corrigé (`resolveLynch` reconnaît
maintenant cette victoire et termine la partie immédiatement, comme les 8
autres conditions de victoire) ; le même scénario réussit maintenant de
façon fiable.

Les deux corrections ont été re-vérifiées sur les 11 600 parties de la
campagne finale sans aucune récidive. Ce sont exactement les bugs
qu'aucun test unitaire ciblé n'aurait trouvés — ils ne surviennent que
quand deux mécaniques se chevauchent au bon (mauvais) moment — et
exactement le genre de chose qu'une vraie partie Telegram aurait aussi pu
déclencher en production sans cette campagne.

### Une anomalie observée une seule fois, non reproduite (honnêteté totale)

Lors d'une campagne intermédiaire de 11 600 parties (avant le dernier
correctif de sharding du harnais, voir `git log` sur
`test/simulation/full-game-stress.test.ts`), **une seule** partie (27
joueurs, mode chaos) s'est terminée sans jamais fixer de camp vainqueur —
sans planter, sans se bloquer non plus, juste sans vainqueur. Tentative de
reproduction : 3 000 parties chaotiques supplémentaires de taille 25 à 35,
puis 1 000 répétitions de la composition de rôles *exacte* de cette
partie — **aucune des 4 000 tentatives n'a reproduit l'anomalie**. Ce
n'est donc ni spécifique à une composition de rôles, ni à une taille de
partie. L'explication la plus probable est un artefact du harnais de test
lui-même (accumulation d'état dans l'implémentation des timers simulés de
vitest sur une très longue exécution cumulée), pas un vrai défaut du
moteur de jeu — mais je ne peux pas l'affirmer avec une certitude absolue
faute de l'avoir reproduite pour l'inspecter. La campagne finale de 11 600
parties (après le correctif de sharding) n'a montré aucune récidive. Je
préfère te le signaler explicitement plutôt que de le passer sous silence.

## 5. Ce qui n'a PAS pu être testé dans cet environnement (à vérifier toi-même)

La simulation ci-dessus élimine l'essentiel du risque côté **logique de
jeu**. Ce qui reste hors de portée dans cet environnement est plus étroit
qu'avant, mais toujours réel :

- ❌ **Aucun appel réel à l'API Telegram** n'a été fait : pas de `BOT_TOKEN`
  disponible dans cet environnement, et le bac à sable de développement
  bloque de toute façon les appels sortants vers `api.telegram.org`. Le
  code du client `grammy` n'a donc jamais été exercé contre le vrai
  serveur Telegram (webhooks, rate limits, formats de clavier inline tels
  qu'ils s'affichent vraiment, épinglage de message, etc.) — seulement
  contre des mocks, aussi poussés soient-ils.
- ❌ **Aucune partie jouée par de vrais humains** dans un vrai groupe
  Telegram. Techniquement, ce point ne peut pas non plus être comblé en te
  fournissant simplement un `BOT_TOKEN` (voir la réponse détaillée donnée
  dans la conversation) : jouer une partie exige plusieurs comptes
  Telegram humains distincts qui rejoignent le groupe et cliquent — un
  agent IA ne peut pas se faire passer pour plusieurs joueurs humains
  différents. Un token permettrait seulement de vérifier que le bot se
  connecte réellement à Telegram (`getMe`, réception d'updates réelle) —
  utile, mais ce n'est pas la même chose que jouer.
- ❌ **`docker compose up --build` n'a pas pu être exécuté tel quel** : le
  pull de l'image `postgres:16-alpine` / `node:20-alpine` depuis Docker Hub
  est bloqué par le réseau du bac à sable (limite de l'environnement de
  développement, pas du projet). Chaque étape du `Dockerfile` a été rejouée
  manuellement en équivalence (installation des dépendances de prod
  isolées, démarrage du process réel avec ce `node_modules` réduit, contre
  un vrai PostgreSQL local installé directement) — mais l'image Docker
  finale elle-même n'a jamais été construite et lancée telle quelle.
- ⚠️ Système de GIFs de mort/victoire : structure de données et repository
  présents et testés, mais **aucun média par défaut** n'est fourni — sans
  soumission manuelle, cette fonctionnalité reste silencieuse. Ce n'est pas
  un oubli : le projet original n'en fournissait pas non plus (fonctionnalité
  payante réservée aux donateurs, jamais livrée avec des GIFs intégrés au
  dépôt). Voir [`DEPLOYMENT.md` §10](./DEPLOYMENT.md#10-ajouter-des-gifs-de-mortvictoire)
  pour la marche à suivre complète (le workflow `/setgif`/`/approvegifs`/
  `/usegifpack` est déjà entièrement fonctionnel).
- ⚠️ Packs de langue au-delà de FR/EN : structure prête à recevoir d'autres
  langues, mais aucune traduction supplémentaire n'a été rédigée.

## 6. Conclusion honnête

Le projet est **prêt pour un premier déploiement réel** : le code compile,
passe tous ses tests, la base de données se met en place automatiquement,
et la procédure de déploiement (`DEPLOYMENT.md`) est complète et cohérente
avec le code (`docker-entrypoint.sh`, `docker-compose.yml`, variables
d'environnement).

Il ne peut pas être qualifié de **« parfait, il ne manque absolument
rien »** tant qu'une vraie partie n'a pas été jouée sur Telegram avec un
vrai `BOT_TOKEN` et de vrais joueurs — c'est un test qu'aucun audit de code
automatisé ne peut remplacer, et que cet environnement ne peut pas
effectuer à ta place (pas d'accès sortant à l'API Telegram ici). C'est la
prochaine étape naturelle : suivre `DEPLOYMENT.md`, créer le bot, et jouer
une première partie à 5 joueurs pour valider l'expérience réelle. Si un
comportement surprenant apparaît à ce moment, il sera très facile à
corriger avec le contexte déjà en place.
