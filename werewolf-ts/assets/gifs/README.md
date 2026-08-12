# GIFs par défaut

Dépose ici les animations que tu veux voir envoyées automatiquement par le
bot, en plus du message texte habituel (mort de nuit, victoire, etc.) —
**sans avoir besoin de passer par `/setgif`/`/approvegifs`/`/usegifpack`**
(cette procédure reste utile pour laisser les *joueurs* soumettre leurs
propres packs par-dessus ce défaut : un pack de groupe ou de joueur approuvé
est toujours prioritaire sur ce qu'il y a ici).

## Nommer les fichiers

Un fichier par catégorie, nommé exactement comme la catégorie, avec
l'extension `.mp4`, `.gif` ou `.webm` (essayées dans cet ordre — un `.mp4`
portant le même nom qu'un `.gif` gagne) :

| Nom de fichier              | Déclenché quand...                                   |
|------------------------------|-------------------------------------------------------|
| `VillagerDie.mp4`            | mort de nuit "générique" (loups, etc.)                |
| `BurnToDeath.mp4`            | mort par le feu (Incendiaire)                         |
| `SKKilled.mp4`                | tué par le Tueur en série                             |
| `VillagersWin.mp4`           | victoire du Village                                    |
| `WolvesWin.mp4`               | victoire des Loups                                     |
| `TannerWin.mp4`               | victoire du Tanner                                     |
| `CultWins.mp4`                | victoire du Culte                                      |
| `SerialKillerWins.mp4`       | victoire du Tueur en série                             |
| `ArsonistWins.mp4`           | victoire de l'Incendiaire                              |
| `LoversWin.mp4`               | victoire des Amoureux                                  |
| `NoWinner.mp4`                 | personne ne gagne                                       |

(`WolfWin.mp4`, `StartGame.mp4` et `StartChaosGame.mp4` existent aussi comme
catégories dans le système de packs personnalisés mais ne sont pas encore
déclenchées par le code actuel — les ajouter ici n'aura donc pas d'effet
pour l'instant.)

## Format

- Vidéo/animation courte (quelques secondes), pas de son nécessaire (Telegram
  le coupe souvent à l'affichage).
- `.mp4` recommandé (le plus fiable pour `sendAnimation`) ; `.gif` fonctionne
  aussi (Telegram le convertit automatiquement en `.mp4` côté serveur).
- Reste raisonnable en taille (quelques Mo max) — le fichier est ré-uploadé
  vers Telegram à chaque envoi tant qu'il n'a pas de `file_id` mis en cache
  (voir `src/infrastructure/telegram/local-gif-pack.ts`).

## Ce dossier est vide par défaut

Ce n'est pas un oubli : ni ce portage, ni le projet original en C# n'ont
jamais livré de GIFs intégrés au dépôt (voir `DEPLOYMENT.md` §10 pour le
détail). Ajoute les tiens ici, ou laisse vide — le bot fonctionne très bien
sans, il enverra simplement le message texte seul.
