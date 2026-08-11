# Règles du jeu et catalogue des rôles

## 1. Déroulement d'une partie

### Lobby

- `/startgame` (mode équilibré) ou `/startchaos` (mode chaos) ouvre
  l'inscription dans un groupe.
- Les joueurs rejoignent avec `/join`. `/players` liste les inscrits,
  `/flee` permet de se désinscrire avant le début.
- Le lobby dure un temps configurable (`/config` → Timers) ; un
  administrateur du groupe peut forcer le démarrage immédiat avec
  `/forcestart`, ou prolonger/raccourcir le compte à rebours avec
  `/extend <secondes>`.
- `/nextgame` inscrit un joueur en message privé pour être notifié dès
  qu'une nouvelle partie démarre dans ce groupe (utile si le lobby est déjà
  fermé) ; `/stopwaiting` annule cette inscription.
- Une fois assez de joueurs réunis (minimum 5), le jeu **répartit
  automatiquement les rôles** selon l'algorithme d'équilibrage (section 4)
  puis distribue les rôles en message privé à chaque joueur.

### Nuit

Chaque rôle actif la nuit reçoit en message privé un clavier de sélection de
cible (Voyante, Loups, Ange Gardien, Chimiste, Voleur, Cupidon la première
nuit, etc.). Une fois le temps de nuit écoulé (ou tous les votes reçus), le
moteur résout toutes les actions dans l'ordre du jeu original (les loups
avant la Voyante, les protections avant les attaques, etc.) et annonce les
morts et messages contextuels au groupe et en privé aux joueurs concernés.

### Jour

Les capacités de jour "à bouton" (Maire, Pacifiste, Forgeron, Marchand de
Sable, Trouble-Fête, Franc-tireur, Citrouille) sont disponibles pendant la
phase de jour, avant le vote de lynchage. Certaines empêchent complètement
la phase de vote (Pacifiste, Marchand de Sable qui saute même la nuit
suivante) ou la dédoublent (Trouble-Fête).

### Vote de lynchage

Chaque joueur vivant vote publiquement (ou secrètement, selon la config,
section 5) pour désigner qui sera pendu. Le joueur avec le plus de voix est
éliminé (égalité = personne n'est lynché, sauf mécanique spéciale de rôle —
Maladroit, Maire, Prince...). Après résolution, retour à la nuit, et ainsi
de suite jusqu'à ce qu'une condition de victoire soit atteinte.

### Fin de partie

Un récapitulatif est envoyé au groupe : camp vainqueur, liste des joueurs
avec leur rôle final et s'ils ont survécu, et badges de donateur le cas
échéant. Les succès (achievements) débloqués pendant la partie sont annoncés
individuellement en privé à chaque joueur concerné.

## 2. Les camps

| Camp | Condition de victoire | Rôles |
|---|---|---|
| **Village** (31 rôles) | Plus aucune menace (loup, culte, tueur en série, incendiaire) en vie | Villageois, Alcoolique, Voyante, Maudit, Ange Gardien, Détective, Chasseur (Gunner), Fusilier (Hunter), Fou, Enfant Sauvage, Tyrannœil, Apprenti Voyant, Chasseur de Cultistes, Franc-Maçon, Cupidon, Sage, Maladroit, Maire, Prince, Homoursporc, Pacifiste, Oracle, Marchand de Sable, Trouble-Fête, Chimiste, Fossoyeur, Forgeron, Citrouille, Augure, Traître |
| **Loups** (6 rôles) | Nombre de loups ≥ nombre des autres survivants | Loup-Garou, Loup Alpha, Louveteau, Lycan, Loup des Neiges, Sorcière |
| **Voleur** (2 rôles, camp "placeholder") | Perd s'il termine la partie sans avoir changé de rôle (sauf victoire des Amoureux) | Voleur, Doppelgänger |
| **Tanneur** | Gagne **seul** en étant lynché | Tanneur |
| **Culte** | Tous les joueurs vivants font partie du culte | Cultiste |
| **Tueur en série** | Dernier survivant | Tueur en série |
| **Incendiaire** | Dernier survivant | Incendiaire |
| **Amoureux** (transversal, pas un camp à part) | Les deux Amoureux sont les deux derniers survivants → victoire commune, quel que soit leur camp d'origine | (n'importe quel rôle désigné par Cupidon) |

## 3. Catalogue complet des 43 rôles

Pour chaque rôle : nom (et nom de code s'il diffère), capacité, règle
spéciale notable. Les commandes `/aboutXXX` en jeu donnent le texte narratif
officiel envoyé aux joueurs (liste complète avec `/rolelist`).

### 🟢 Village

1. **Villageois** (`Villager`) — aucun pouvoir, vote au lynchage.
2. **Alcoolique** (`Drunk`) — passif ; si attaqué par les loups, meurt
   normalement mais rend toute la meute "ivre" (bloquée) la nuit suivante.
3. **Voyante** (`Seer`) — nuit : révèle le rôle réel d'une cible. Certains
   rôles trompent volontairement sa vision (Louveteau/Loup Alpha vus comme
   "Loup" générique, Homoursporc vu comme Loup, Lycan vu comme Villageois).
4. **Maudit** (`Cursed`) — passif ; s'il est mordu/dévoré par les loups, il
   devient automatiquement Loup. Peut aussi être converti au culte.
5. **Ange Gardien** (`GuardianAngel`) — nuit : protège un joueur d'une mort
   cette nuit. Risque : 50% de mourir en protégeant un Loup ; peut aussi
   sauver quelqu'un d'un incendie ou nettoyer le kérosène versé par
   l'Incendiaire.
6. **Détective** (`Detective`) — jour : enquête et découvre le vrai rôle
   d'un joueur. 40% de chance que les loups apprennent son identité.
7. **Chasseur** (`Gunner`) — jour : 2 balles d'argent, tir public (révèle
   son rôle). Tuer le Sage lui fait perdre son pouvoir (redevient Villageois).
8. **Fusilier** (`Hunter`) — réactif : attaqué par les loups, chance
   croissante d'abattre un loup en retour. À sa mort, tire un dernier coup
   au choix sur un joueur. Face au culte : 50% converti, sinon 50% de tuer
   le convertisseur.
9. **Fou** (`Fool`) — nuit : choisit un joueur mais reçoit une vision d'un
   **rôle aléatoire**, pas forcément celui de la cible.
10. **Enfant Sauvage** (`WildChild`) — choisit une idole en début de partie ;
    si elle meurt, se transforme immédiatement en Loup.
11. **Tyrannœil** (`Beholder`) — passif : connaît l'identité de la vraie
    Voyante (jamais celle du Fou).
12. **Apprenti Voyant** (`ApprenticeSeer`) — simple villageois jusqu'à la
    mort de la Voyante ; devient alors automatiquement la nouvelle Voyante.
13. **Chasseur de Cultistes** (`CultistHunter`) — nuit : traque un suspect,
    le tue s'il est réellement Cultiste. Si le culte tente de le convertir,
    c'est le membre le plus récent du culte qui meurt à sa place.
14. **Franc-Maçon** (`Mason`) — passif : connaît l'identité du/des autre(s)
    Franc(s)-Maçon(s).
15. **Cupidon** (`Cupid`) — action unique en tout début de partie : désigne
    deux Amoureux (voir camp transversal ci-dessus).
16. **Sage** (`WiseElder`) — passif : survit à la **première** attaque de
    loups (une seule fois). Le tuer via le Fusilier ou le Chasseur leur
    fait perdre leur pouvoir spécial.
17. **Maladroit** (`ClumsyGuy`) — passif : 50% de chance que son vote de
    lynchage soit redirigé aléatoirement vers un autre joueur vivant.
18. **Maire** (`Mayor`) — jour, action unique : "Révéler" double
    définitivement le poids de son vote de lynchage.
19. **Prince** (`Prince`) — passif, usage unique : la première fois qu'il
    est désigné pour être lynché, il survit (vote annulé ce jour-là).
20. **Homoursporc** (`WolfMan`) — passif : villageois pur, mais apparaît
    trompeusement comme un Loup aux yeux de la Voyante.
21. **Pacifiste** (`Pacifist`) — jour, action unique : "Déclarer la paix"
    annule complètement le lynchage du jour.
22. **Oracle** (`Oracle`) — nuit : révèle un rôle qu'un joueur choisi **ne
    possède pas**, parmi les rôles encore vivants.
23. **Marchand de Sable** (`Sandman`) — jour, action unique : "Sommeil"
    annule toute action nocturne (loups compris) la nuit suivante.
24. **Trouble-Fête** (`Troublemaker`) — jour, action unique : force un
    double lynchage le même jour (annule une paix déjà déclarée).
25. **Chimiste** (`Chemist`) — nuit : 50% de chance d'empoisonner sa cible,
    50% que la potion se retourne contre lui-même. Empoisonner le Sage lui
    fait perdre son pouvoir.
26. **Fossoyeur** (`GraveDigger`) — action automatique chaque nuit : creuse
    les tombes des morts récents et en apprend le nombre. Risque : tout
    visiteur nocturne (loups, tueur en série, Ange Gardien...) peut tomber
    dans une tombe fraîche et mourir (probabilité croissante avec le
    nombre de tombes) ; lui-même risque d'être repéré et tué s'il a creusé
    cette nuit-là.
27. **Forgeron** (`Blacksmith`) — jour, action unique : "Répandre l'argent"
    empêche toute la meute (et le Loup des Neiges) d'agir la nuit suivante.
28. **Citrouille** (`Spumpkin`, pas désactivable) — jour : choisit une
    cible à faire détoner ; 40% de chance que l'explosion le tue aussi.
    Tuer le Sage lui fait perdre son pouvoir.
29. **Augure** (`Augur`) — chaque matin : révèle un rôle **absent** du
    village.
30. **Traître** (`Traitor`) — village tant que la meute existe ; si tous
    les vrais Loups meurent alors qu'il est encore vivant, il est
    automatiquement promu Loup.

### 🔴 Loups

1. **Loup-Garou** (`Wolf`) — nuit : la meute vote et dévore une victime
   (jusqu'à 2 cibles/nuit en cas de double vote majoritaire).
2. **Loup Alpha** (`AlphaWolf`) — tant qu'il est vivant, 20% de chance que
   chaque attaque de meute **morde** (convertit en Loup) au lieu de tuer.
3. **Louveteau** (`WolfCub`) — s'il meurt, la meute obtient le droit de
   tuer 2 victimes la nuit suivante.
4. **Lycan** (`Lycan`) — loup à part entière, mais apparaît trompeusement
   comme un Villageois innocent aux yeux de la Voyante.
5. **Loup des Neiges** (`SnowWolf`) — solitaire, agit indépendamment de la
   meute. Nuit : gèle un joueur (l'empêche d'agir), jamais deux fois de
   suite la même cible. Risque : geler le Fusilier peut se retourner
   contre lui.
6. **Sorcière** (`Sorcerer`) — équivalent loup de la Voyante ; ne détecte
   que si la cible est un Loup, la vraie Voyante, ou le Loup des Neiges.

### 🎭 Voleur (camp neutre "placeholder")

1. **Voleur** (`Thief`) — par défaut : vole (échange) le rôle d'une cible
   lors de la **première nuit uniquement**, la victime devient Villageois.
   En variante "Voleur à chaque tour" (voir option `CfgThiefFull`) : chaque
   nuit, 50% de chance de voler le rôle de sa cible.
2. **Doppelgänger** (`Doppelganger`) — choisit un "modèle" en début de
   partie ; si ce modèle meurt, prend immédiatement son rôle.

### 🕳️ Camps solo/neutres

1. **Tanneur** (`Tanner`) — aucun pouvoir ; gagne immédiatement s'il est
   lynché (et fait perdre tous les autres, sauf Amoureux).
2. **Cultiste** (`Cultist`) — nuit : le membre le plus récemment converti
   tente de convertir une nouvelle cible (chance variable selon le rôle
   visé). Gagne quand tous les vivants sont dans le culte.
3. **Tueur en série** (`SerialKiller`) — nuit : tue librement n'importe qui
   (loups compris), ignore les protections classiques (sauf l'Ange
   Gardien). Attaqué par la meute, il tue automatiquement un loup au
   hasard et survit. Gagne seul en étant le dernier survivant.
4. **Incendiaire** (`Arsonist`) — nuit : arrose une maison de kérosène
   (ignore le gel du Loup des Neiges), puis peut déclencher une étincelle
   qui brûle toutes les maisons arrosées. Gagne seul en étant le dernier
   survivant.

## 4. Équilibrage automatique des parties (mode `Normal`)

En mode `Normal` (par opposition à `Chaos`), l'algorithme (`game-balancing.ts`)
construit un pool de rôles candidats puis retire une composition aléatoire
jusqu'à ce qu'elle satisfasse toutes ces contraintes (jusqu'à 500 tentatives) :

- Au moins un vrai camp adverse et une équipe village.
- Le nombre d'ennemis reste strictement inférieur au nombre de villageois.
- La force totale du camp village et celle du/des camp(s) adverse(s)
  (chaque rôle a un score de "force" fixe, `getStrength()`) ne diffère pas
  de plus de `playerCount / 4 + 1`.
- Pas plus d'un rôle "révélé" (Forgeron, Maire, Pacifiste, Chasseur,
  Marchand de Sable, Trouble-Fête) par tranche de 3 joueurs.
- Pas plus d'un rôle bloquant le lynchage/la nuit (Trouble-Fête, Marchand
  de Sable, ou Forgeron en l'absence d'autre menace) par tranche de 4
  joueurs.
- Quelques correctifs automatiques : une Sorcière/Traître/Loup des Neiges
  sans aucun Loup dans la partie est reconvertie en Loup ; un Cultiste sans
  Chasseur de Cultistes en fait apparaître un ; un Apprenti Voyant sans
  Voyante devient directement Voyante.

Le nombre de loups dans le pool de départ est calculé comme
`min(max(playerCount / 5, 1), 5)`. Le mode `Chaos` (`/startchaos`) désactive
la vérification d'équilibre de force (les autres contraintes structurelles
restent) : compositions volontairement plus imprévisibles.

## 5. Options de configuration de groupe (`/config`)

Menu en message privé, réservé aux administrateurs du groupe (admins
anonymes pris en charge). Sections :

- **Rôles** — active/désactive individuellement chacun des 43 rôles pour ce
  groupe.
- **Options** :
  - `Voleur à chaque tour` (`thiefFull`) — le Voleur peut voler un rôle
    toutes les nuits plutôt qu'à la première nuit seulement.
  - `Overkill autorisé` (`burningOverkill`) — autorise Tueur en série +
    Incendiaire dans la même partie.
  - `Afficher les rôles à la mort` (`showRolesOnDeath`)
  - `Afficher les identifiants` (`showIds`)
  - `Mélanger la liste des joueurs` (`shufflePlayerList`)
  - `Mode aléatoire` (`randomMode`)
  - `Vote secret` (`secretLynch`), avec deux sous-options : afficher le
    décompte final des voix (`secretLynchShowVotes`) et afficher qui a
    voté pour qui après coup (`secretLynchShowVoters`)
  - `Autoriser la prolongation` (`allowExtend`)
  - `Autoriser la fuite` (`allowFlee`)
  - `Autoriser le NSFW` (`allowNsfw`) — pour les packs de GIFs personnalisés
  - `Autoriser le Tanneur` / `le Fou` / `le Culte` / `le Voleur` /
    `l'Incendiaire` — bascules rapides pour ces rôles à fort impact narratif
- **Mode** — `PlayerChoice` (au choix au lancement), `Normal`, `Chaos`.
- **Timers** — durée des phases Jour / Nuit / Vote de lynchage / durée de
  prolongation par défaut.
- **Nombre max de joueurs**.
- **Affichage des rôles en fin de partie** — Aucun / Vivants seulement /
  Tous.
- **Langue** — langue du groupe, et pack de langue (un seul pack "default"
  disponible actuellement par langue, voir `ARCHITECTURE.md` section 8).

## 6. Succès (achievements)

Plus de 100 succès, débloqués automatiquement en fin de partie ou en cours
de partie selon des conditions basées sur les `GameEvent` émis (qui a
visité qui, qui a survécu à quoi, séquences de votes, etc.). Consultables
en privé avec `/achv`. Un administrateur global peut forcer l'attribution ou
le retrait d'un succès (`/addach`, `/remach`) ou le transférer d'un compte à
un autre (`/moveachv`, dev uniquement).
