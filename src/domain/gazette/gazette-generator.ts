import { Game } from '../game/game.aggregate.js';
import type { GameEvent } from '../game/game-event.js';

export interface GazetteStory {
  title: string;
  lines: string[];
}

export const LAST_GAZETTES_BY_CHAT = new Map<string, GazetteStory>();

/**
 * Generates an epic, hilarious theatrical story ("La Gazette du Village")
 * explicitly featuring player names and funny event breakdowns.
 */
export function generateGazette(game: Game, batches: (readonly GameEvent[])[], language: string = 'fr'): GazetteStory {
  const isFr = language === 'fr';
  const playerMap = new Map(game.players.map((p) => [p.id, p.name]));

  const title = isFr
    ? '📜 <b>LA GAZETTE DU VILLAGE — ÉDITION HILARANTE DE FIN DE PARTIE</b> 🗞️'
    : '📜 <b>THE VILLAGE GAZETTE — HILARIOUS END EDITION</b> 🗞️';

  const lines: string[] = [];

  const winningTeam = game.winningTeam ?? 'Village';
  const totalPlayers = game.players.length;

  // Intro
  if (isFr) {
    lines.push(`<i>Le calme revient enfin sur Thiercelieux après un véritable feu d'artifice de trahisons entre ${totalPlayers} habitants ! Voici les nouvelles fraîches de la gazette :</i>\n`);
  } else {
    lines.push(`<i>Calm finally returns to Thiercelieux after a fireworks display of betrayals among ${totalPlayers} villagers! Here is the latest gossip from the gazette:</i>\n`);
  }

  // Parse events & group by type with player names
  const wolfVictims: string[] = [];
  const lynchVictims: string[] = [];
  const specialVictims: string[] = [];

  for (const batch of batches) {
    for (const event of batch) {
      if (event.type === 'PlayerDied') {
        const victimName = playerMap.get(event.playerId) ?? `Joueur #${event.playerId}`;
        if (event.method === 'Eat') {
          wolfVictims.push(victimName);
        } else if (event.method === 'Lynch') {
          lynchVictims.push(victimName);
        } else {
          specialVictims.push(victimName);
        }
      }
    }
  }

  // Breakdown of deaths with comical commentary and player names
  if (isFr) {
    if (wolfVictims.length > 0) {
      lines.push(`🐺 <b>Casse-Croûte des Loups :</b>`);
      wolfVictims.forEach((name) => {
        lines.push(`  • <b>${name}</b> s'est fait dévorer en pyjama au beau milieu de la nuit !`);
      });
      lines.push('');
    }
    if (lynchVictims.length > 0) {
      lines.push(`⚖️ <b>Procès de la Potence :</b>`);
      lynchVictims.forEach((name) => {
        lines.push(`  • <b>${name}</b> a été traîné au gibet sous les tomates et les huées de la foule !`);
      });
      lines.push('');
    }
    if (specialVictims.length > 0) {
      lines.push(`💥 <b>Morts Insolites & Magie Noire :</b>`);
      specialVictims.forEach((name) => {
        lines.push(`  • <b>${name}</b> a goûté à une balle en argent ou à une potion douteuse...`);
      });
      lines.push('');
    }
  } else {
    if (wolfVictims.length > 0) {
      lines.push(`🐺 <b>Wolf Midnight Snack:</b>`);
      wolfVictims.forEach((name) => {
        lines.push(`  • <b>${name}</b> got munched on in pajamas in the dead of night!`);
      });
      lines.push('');
    }
    if (lynchVictims.length > 0) {
      lines.push(`⚖️ <b>Gallows Trial:</b>`);
      lynchVictims.forEach((name) => {
        lines.push(`  • <b>${name}</b> was dragged to the rope amid flying tomatoes and crowd jeers!`);
      });
      lines.push('');
    }
    if (specialVictims.length > 0) {
      lines.push(`💥 <b>Unusual Fatalities & Dark Magic:</b>`);
      specialVictims.forEach((name) => {
        lines.push(`  • <b>${name}</b> tested out a silver bullet or a shady potion...`);
      });
      lines.push('');
    }
  }

  // Survivors list
  const survivors = game.players.filter((p) => !p.isDead).map((p) => p.name);
  if (survivors.length > 0) {
    if (isFr) {
      lines.push(`🥂 <b>Les Glorieux Survivants :</b> <b>${survivors.join(', ')}</b> (qui fêtent ça à la taverne du village !)\n`);
    } else {
      lines.push(`🥂 <b>Glorious Survivors:</b> <b>${survivors.join(', ')}</b> (currently partying at the village pub!)\n`);
    }
  } else {
    if (isFr) {
      lines.push(`🪦 <b>Cimetière Général :</b> Plus un seul habitant debout... le cimetière affiche complet !\n`);
    } else {
      lines.push(`🪦 <b>Ghost Town:</b> Not a single soul survived... absolute zero!\n`);
    }
  }

  // Climax / Outcome
  const winningTeamStr = String(winningTeam);
  if (isFr) {
    if (winningTeamStr === 'Village') {
      lines.push(`✨ <b>DÉNOUEMENT :</b> Les villageois ont triomphé ! Les monstres sont démasqués et la sérénité revient à Thiercelieux.`);
    } else if (winningTeamStr === 'Wolves' || winningTeamStr === 'Wolf') {
      lines.push(`🐺 <b>DÉNOUEMENT :</b> Les loups ont croqué tout le monde ! Le village est devenu leur terrain de jeu personnel.`);
    } else if (winningTeamStr === 'Tanner') {
      lines.push(`🤡 <b>DÉNOUEMENT :</b> Le Tanneur a berné toute la communauté et rigole aux éclats depuis la potence !`);
    } else if (winningTeamStr === 'Cult') {
      lines.push(`🔮 <b>DÉNOUEMENT :</b> Le Culte a embrigadé tout le village. Tout le monde chante sous les étoiles !`);
    } else if (winningTeamStr === 'SerialKiller') {
      lines.push(`🔪 <b>DÉNOUEMENT :</b> Le Tueur en série est le seul debout dans une clairière couverte de cadavres...`);
    } else {
      lines.push(`🏆 <b>DÉNOUEMENT :</b> Victoire héroïque de l'équipe <b>${winningTeamStr}</b> !`);
    }
  } else {
    if (winningTeamStr === 'Village') {
      lines.push(`✨ <b>OUTCOME:</b> The villagers won! The monsters were exposed and peace returns to Thiercelieux.`);
    } else if (winningTeamStr === 'Wolves' || winningTeamStr === 'Wolf') {
      lines.push(`🐺 <b>OUTCOME:</b> The wolves ate everyone! The village is now their private kingdom.`);
    } else if (winningTeamStr === 'Tanner') {
      lines.push(`🤡 <b>OUTCOME:</b> The Tanner duped the entire town and is cackling happily from the gallows!`);
    } else if (winningTeamStr === 'Cult') {
      lines.push(`🔮 <b>OUTCOME:</b> The Cult brainwashed the village. Everyone is chanting under the stars!`);
    } else if (winningTeamStr === 'SerialKiller') {
      lines.push(`🔪 <b>OUTCOME:</b> The Serial Killer is the last soul standing in a clearing of fallen bodies...`);
    } else {
      lines.push(`🏆 <b>OUTCOME:</b> Epic victory for team <b>${winningTeamStr}</b>!`);
    }
  }

  return { title, lines };
}
