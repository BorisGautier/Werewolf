# Tester en local

Ce document liste tout ce qu'on peut vérifier avant de redéployer, du plus
rapide (secondes) au plus complet (jouer une vraie partie avec un vrai bot
Telegram). Fais-les dans cet ordre : chaque niveau attrape une catégorie de
bugs que le précédent ne peut pas voir.

## 0. Installation

```bash
npm install
```

## 1. Vérifications statiques (aucune base de données requise)

```bash
npm run lint                                    # ESLint
npx tsc -p tsconfig.eslint.json --noEmit         # typecheck src/ ET test/
npm run build                                     # compile src/ -> dist/ (tsconfig.json, sans test/)
```

⚠️ **Utilise toujours `tsc -p tsconfig.eslint.json --noEmit`, pas juste
`npm run build`**, pour vérifier les types. `tsconfig.json` (utilisé par
`build`) n'inclut que `src/**/*.ts` — une erreur de type dans un fichier de
test (souvent une fixture périmée après un changement de forme d'un
`GameEvent`) ne serait jamais détectée par `build` seul, et Vitest ne
type-check pas non plus les tests qu'il exécute (mode transpile-only). Ces
deux commandes sont donc complémentaires, pas redondantes.

## 2. Tests unitaires

```bash
npm run test          # une seule passe
npm run test:watch    # relance automatiquement au fil des modifications
```

~494 tests, aucune base de données ni token Telegram requis — tout est en
mémoire. Organisation (`test/`) :

- `test/domain/**` — le moteur de jeu pur : résolution de nuit rôle par
  rôle, vote de lynchage, pipeline de mort, conditions de victoire,
  équilibrage, succès. C'est ici qu'ajouter un test pour une nouvelle règle
  de jeu ou corriger un bug de résolution.
- `test/infrastructure/**` — bot Telegram (avec un objet `bot` mocké),
  repositories (avec un client Prisma mocké), i18n, cron, anti-spam. Regarde
  `test/infrastructure/game-loop.test.ts` pour le patron de harnais de test
  utilisé (un faux `bot.api` qui enregistre les appels au lieu de les
  exécuter).
- `test/application/**` — `GameManager` (registre en mémoire).
- `test/simulation/full-game-stress.test.ts` — joue des parties complètes
  de bout en bout (répartition des rôles réelle via `balance()`, tailles de
  5 à 35 joueurs) selon 6 stratégies de vote de lynchage différentes
  (aléatoire, unanime, égalité forcée, abstention totale, vote ciblé sur le
  Tanner, vote ciblé sur le Prince — un vote purement indépendant par
  joueur ne reproduit jamais un vrai groupe qui se coordonne), plus deux
  scénarios déterministes dédiés (composition de rôles imposée) pour
  prouver les deux issues les plus rares (égalité de vote, victoire du
  Tanner par lynchage). Chaque menu nuit/jour/vote est répondu via
  `GameLoop.handleCallback()`, exactement l'appel qu'un vrai clic Telegram
  déclenche, sans jamais toucher le réseau. Utile pour détecter ce que les
  tests unitaires ciblés ne voient pas : une exception non gérée à grande
  échelle, une partie qui ne se termine jamais (le garde-fou anti-boucle-
  infinie des timers simulés de vitest le détecte), ou une partie qui se
  termine sans camp vainqueur — c'est exactement comme ça que deux vrais
  bugs ont été trouvés pendant l'audit initial (voir `REQUIREMENTS.md`).
  Par défaut ~58 parties (rapide, fait partie de `npm test`) ; pour un
  balayage plus profond (les campagnes de plus de 1000 parties se
  découpent automatiquement en plusieurs tests pour rester rapides) :
  ```bash
  SIM_SCALE=200 npx vitest run test/simulation   # ~11 600 parties, ~2-3 min
  ```
  Le résumé affiché en console liste les rôles jamais distribués, la
  répartition des camps vainqueurs et des issues de vote — utile pour
  repérer une combinaison de rôles qui plante systématiquement.

Pour lancer un seul fichier ou filtrer par nom :

```bash
npx vitest run test/domain/night-resolution.snowwolf.test.ts
npx vitest run -t "guardian angel"
```

## 3. Base de données locale (sans Docker)

Si tu as PostgreSQL déjà installé sur ta machine (`pg_ctlcluster`/`postgres`
disponibles), pas besoin de Docker pour développer :

```bash
sudo -u postgres psql -c "CREATE DATABASE werewolf;"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"

cp .env.example .env
# dans .env :
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/werewolf?schema=public
#   BOT_TOKEN=<peu importe pour cette étape, voir section 5>

npx prisma migrate deploy   # applique les migrations existantes (prisma/migrations/)
npx prisma generate          # régénère le client (déjà fait par migrate en général)
```

### Avec Docker à la place

```bash
docker compose up -d db
# DATABASE_URL=postgresql://werewolf:werewolf@localhost:5432/werewolf?schema=public
npx prisma migrate deploy
```

### Vérifier que le schéma est bien appliqué

```bash
npx prisma studio             # interface web pour explorer/éditer les données
# ou en ligne de commande :
psql "$DATABASE_URL" -c "\dt"                          # doit lister 14 tables
psql "$DATABASE_URL" -c "SELECT count(*) FROM achievements;"  # 0 tant que le bot n'a pas démarré une fois
```

### Après avoir modifié `prisma/schema.prisma`

```bash
npx prisma migrate dev --name description_du_changement
```

Ceci crée un nouveau dossier dans `prisma/migrations/` avec le SQL généré
**et** l'applique à ta base locale. Committe ce nouveau dossier avec ton
changement de schéma — c'est ce que `prisma migrate deploy` rejouera en
production (voir `DEPLOYMENT.md`). N'édite jamais un fichier de migration
déjà commité et déjà appliqué quelque part : crée-en un nouveau.

## 4. Démarrage du process complet (sans bot réel)

Une fois la base prête (section 3), tu peux démarrer le process avec un
`BOT_TOKEN` invalide pour vérifier que tout le câblage jusqu'à
l'initialisation Telegram fonctionne (connexion DB, seed des achievements,
chargement des locales) :

```bash
BOT_TOKEN=invalid:token npm run dev
```

Logs attendus, dans l'ordre :

```
{"msg":"Connected to database"}
{"msg":"Achievement catalog seeded"}
```

Le process restera ensuite bloqué sur l'appel `bot.init()` (Telegram
rejette le token) — c'est normal et attendu, `Ctrl+C` pour arrêter. Ça
suffit à confirmer que la couche persistance et la couche i18n sont
opérationnelles sans consommer un vrai bot.

## 5. Test avec un vrai bot Telegram (recommandé avant tout déploiement)

Un bot de test coûte rien et prend 2 minutes à créer — ne teste jamais tes
changements pour la première fois directement sur le bot de production.

**Tu peux jouer avec de vraies autres personnes (amis, autres comptes à toi)
alors que le bot tourne sur ta propre machine, sans aucune configuration
réseau** — pas de tunnel (ngrok...), pas de port à ouvrir, pas d'IP publique.
Le bot fonctionne en *long polling* : c'est lui qui va chercher les messages
auprès de Telegram, pas l'inverse — n'importe qui sur Telegram peut donc
interagir avec un bot qui tourne sur ton laptop derrière ta box internet,
exactement comme s'il tournait sur un serveur (voir `DEPLOYMENT.md`
introduction). C'est littéralement le même process que celui déployé en
production, juste lancé depuis ton terminal au lieu d'un conteneur Docker
sur un VPS.

1. Crée un second bot avec [@BotFather](https://t.me/BotFather) (voir
   `DEPLOYMENT.md` section 1), ex. `MonLoupGarouTestBot`.
2. `/setprivacy` → `Disable` sur ce bot de test aussi.
3. `BOT_TOKEN=<token du bot de test>` dans ton `.env` local.
4. `DEV_USER_IDS=<ton id Telegram>` pour accéder aux commandes dev
   (`/maintenance`, `/getroles`, `/skipvote`, ...) pendant tes tests.
5. `npm run dev` (mode watch — redémarre automatiquement à chaque
   modification de fichier ; laisse tourner tant que la partie dure).
6. Crée un groupe Telegram, ajoute-y ton bot de test, promeus-le
   administrateur, puis **invite les autres joueurs dans ce groupe** (un
   lien d'invitation Telegram classique suffit — ils n'ont besoin de rien
   d'autre que Telegram).

### Jouer une partie complète pour valider un changement

- `/startgame` avec au moins 5 comptes (des comptes de test, ou demande à
  des amis de rejoindre brièvement) — le minimum de joueurs est fixé par
  l'algorithme d'équilibrage (voir `GAMEPLAY.md` section 4).
- `/skipvote` (dev-only) force la résolution immédiate de la phase en
  cours sans attendre le timer complet — très utile pour dérouler une
  partie de test rapidement au lieu d'attendre les timers réels.
- `/getroles` (dev-only) affiche les rôles de tous les joueurs d'une
  partie en cours, pratique pour vérifier que l'équilibrage ou la
  résolution de nuit se comporte comme attendu sans deviner à l'aveugle.
- `/killgame` (admin global) tue immédiatement la partie en cours si tu as
  besoin de repartir de zéro sans attendre la fin naturelle.

### Astuce : réduire les timers pendant les tests manuels

Dans le menu `/config` → Timers du groupe de test, mets des durées très
courtes (quelques secondes) pour ne pas attendre les timers de production
(souvent plusieurs minutes) à chaque itération.

## 6. Avant de committer / pousser

Enchaîne systématiquement, dans cet ordre :

```bash
npx tsc -p tsconfig.eslint.json --noEmit
npm run lint
npm run test
npm run build
```

Les quatre doivent être verts. C'est exactement la séquence utilisée tout
au long du développement de ce projet avant chaque commit.

## 7. Ce qui ne peut PAS être testé sans un environnement réel

Honnêteté totale, pour éviter toute fausse impression de couverture totale :

- **Aucun test automatisé n'appelle jamais la vraie API Telegram.** Ce
  serait un test d'intégration nécessitant un token Telegram valide et un
  réseau sortant, ce que l'intégration continue ne peut pas garantir de
  façon fiable et reproductible. Les tests `test/infrastructure/*.test.ts`
  et `test/simulation/full-game-stress.test.ts` mockent l'objet `bot`
  (aucun appel réseau réel) — ce qui couvre exhaustivement la logique du
  moteur de jeu et son câblage (voir §2, `full-game-stress.test.ts` peut
  faire tourner des milliers de parties complètes de bout en bout), mais jamais
  le comportement réel de l'API Telegram elle-même (limites de débit,
  formats de clavier effectivement rendus dans l'appli, latence réseau) ni
  l'expérience d'un vrai joueur humain qui clique dans Telegram.
- `GunnerSaves`/`ReallyBadLuck` (`src/domain/achievements/evaluate.ts`)
  étaient auparavant annotés "best effort, deferred" (non implémentés,
  faute d'un événement portant l'information nécessaire) - corrigés en
  s'appuyant sur `GunnerPreventsWolfWin`/`SerialKillerRandomKill` +
  `GuardianAngelBlockedSerialKiller`, qui portaient déjà tout ce qu'il
  fallait ; testés dans `test/domain/achievements/evaluate.test.ts`.
  Il reste un seul achievement réellement hors de portée de l'évaluateur
  pur actuel (`CultFodder` - il faudrait savoir quel cultiste précis une
  conversion du Chasseur de culte a ciblé, une info qu'aucun événement ne
  porte aujourd'hui) - marqué `Deferred` dans le fichier, sans impact sur
  le jeu lui-même (uniquement un succès cosmétique non débloqué).
- Recommandation : après tout changement touchant `game-loop.ts` ou aux
  résolveurs de nuit d'un rôle sensible, joue au moins une partie manuelle
  complète avec ce rôle (section 5) avant de déployer en production.
