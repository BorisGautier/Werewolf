import { Game } from '../game/game.aggregate.js';
import type { GameEvent } from '../game/game-event.js';

export interface GazetteStory {
  title: string;
  lines: string[];
}

export const LAST_GAZETTES_BY_CHAT = new Map<string, GazetteStory>();

/**
 * Generates an epic, humorous theatrical story ("La Gazette du Village") summarizing the game events.
 */
export function generateGazette(game: Game, batches: (readonly GameEvent[])[], language: string = 'fr'): GazetteStory {
  const isFr = language === 'fr';

  const title = isFr
    ? '📜 <b>LA GAZETTE DU VILLAGE — ÉDITION DU SOIR</b> 🗞️'
    : '📜 <b>THE VILLAGE GAZETTE — EVENING EDITION</b> 🗞️';

  const lines: string[] = [];

  const winningTeam = game.winningTeam ?? 'Village';
  const totalPlayers = game.players.length;
  const deadCount = game.players.filter((p) => p.isDead).length;

  // Intro
  if (isFr) {
    lines.push(`<i>Le soleil s'est couché sur Thiercelieux... Une bataille d'esprits et de crocs s'est jouée entre ${totalPlayers} habitants.</i>\n`);
  } else {
    lines.push(`<i>The sun has set over Thiercelieux... A battle of wits and fangs unfolded among ${totalPlayers} villagers.</i>\n`);
  }

  // Highlights analysis
  let wolfKills = 0;
  let lynchKills = 0;
  let specialKills = 0;

  for (const batch of batches) {
    for (const event of batch) {
      if (event.type === 'PlayerDied') {
        if (event.method === 'Eat') wolfKills++;
        else if (event.method === 'Lynch') lynchKills++;
        else specialKills++;
      }
    }
  }

  if (isFr) {
    if (wolfKills > 0) {
      lines.push(`🩸 <b>Attaques Nocturnes :</b> La meute de loups a frappé ${wolfKills} fois dans les ombres de la nuit.`);
    }
    if (lynchKills > 0) {
      lines.push(`⚖️ <b>Justice Populaire :</b> Le village en colère a mené ${lynchKills} condamnation(s) à la potence.`);
    }
    if (specialKills > 0) {
      lines.push(`⚡️ <b>Pouvoirs Sombre & Potions :</b> La sorcellerie et les balles ont fait ${specialKills} victime(s) supplémentaire(s).`);
    }
  } else {
    if (wolfKills > 0) {
      lines.push(`🩸 <b>Nightly Raids:</b> The wolfpack struck ${wolfKills} time(s) under the cover of darkness.`);
    }
    if (lynchKills > 0) {
      lines.push(`⚖️ <b>Village Justice:</b> An angry mob carried out ${lynchKills} lynchings at the gallows.`);
    }
    if (specialKills > 0) {
      lines.push(`⚡️ <b>Dark Magic & Bullets:</b> Spells and silver bullets claimed ${specialKills} additional victim(s).`);
    }
  }

  // Climax / Outcome
  lines.push('');
  const winningTeamStr = String(winningTeam);
  if (isFr) {
    if (winningTeamStr === 'Village') {
      lines.push(`✨ <b>DÉNOUEMENT :</b> Les villageois ont triomphé ! Les démons ont été démasqués et la paix règne de nouveau.`);
    } else if (winningTeamStr === 'Wolves' || winningTeamStr === 'Wolf') {
      lines.push(`🐺 <b>DÉNOUEMENT :</b> Les loups ont dévoré le village... Les hurlements de la meute résonnent à jamais.`);
    } else if (winningTeamStr === 'Tanner') {
      lines.push(`🤡 <b>DÉNOUEMENT :</b> Le Tanneur a trompé tout le monde et rit aux éclats depuis la potence !`);
    } else if (winningTeamStr === 'Cult') {
      lines.push(`🔮 <b>DÉNOUEMENT :</b> Le Culte a étendu son emprise secrète. Tout le village s'est agenouillé !`);
    } else if (winningTeamStr === 'SerialKiller') {
      lines.push(`🔪 <b>DÉNOUEMENT :</b> Le Tueur en série est le seul survivant dans une clairière couverte de cadavres...`);
    } else {
      lines.push(`🏆 <b>DÉNOUEMENT :</b> Victoire éclatante de l'équipe <b>${winningTeamStr}</b> ! (${deadCount} morts au total)`);
    }
  } else {
    if (winningTeamStr === 'Village') {
      lines.push(`✨ <b>OUTCOME:</b> The villagers prevailed! The beasts were unmasked and peace returned.`);
    } else if (winningTeamStr === 'Wolves' || winningTeamStr === 'Wolf') {
      lines.push(`🐺 <b>OUTCOME:</b> The wolves devoured the entire village... Howls echo through the dark forest.`);
    } else if (winningTeamStr === 'Tanner') {
      lines.push(`🤡 <b>OUTCOME:</b> The Tanner fooled everyone and is laughing out loud from the gallows!`);
    } else if (winningTeamStr === 'Cult') {
      lines.push(`🔮 <b>OUTCOME:</b> The Cult converted the whole village. Everyone kneels before the altar!`);
    } else if (winningTeamStr === 'SerialKiller') {
      lines.push(`🔪 <b>OUTCOME:</b> The Serial Killer stands alone over a clearing of fallen bodies...`);
    } else {
      lines.push(`🏆 <b>OUTCOME:</b> Spectacular victory for team <b>${winningTeamStr}</b>! (${deadCount} total casualties)`);
    }
  }

  return { title, lines };
}
