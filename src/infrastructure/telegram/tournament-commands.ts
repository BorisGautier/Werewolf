import type { CommandContext, Context } from 'grammy';
import type { TournamentRepository } from '../persistence/tournament.repository.js';
import type { PlayerRepository } from '../persistence/player.repository.js';

/** Neutralizes Telegram legacy-Markdown syntax (`_`, `*`, `` ` ``, `[`) in free-form,
 * player-chosen text (team/tournament names) before it's dropped into a `parse_mode: 'Markdown'`
 * message - otherwise a crafted name like `[click me](https://evil)` renders as a real link, or
 * unbalanced `*`/`_` breaks the whole message ("can't parse entities"). */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, String.raw`\$1`);
}

export class TournamentCommandHandler {
  constructor(
    private readonly tournamentRepo: TournamentRepository,
    private readonly playerRepo?: PlayerRepository,
  ) {}

  /**
   * Registers all tournament-related Telegram bot commands.
   */
  registerCommands(bot: any) {
    bot.command(['tournoi', 'tournament'], (ctx: CommandContext<Context>) =>
      this.handleTournoiMenu(ctx),
    );
    bot.command('creerequipe', (ctx: CommandContext<Context>) => this.handleCreerEquipe(ctx));
    bot.command('rejoindreequipe', (ctx: CommandContext<Context>) =>
      this.handleRejoindreEquipe(ctx),
    );
    bot.command('monequipe', (ctx: Context) => this.handleMonEquipe(ctx));
    bot.command('inscrirefournoi', (ctx: CommandContext<Context>) =>
      this.handleInscrireTournoi(ctx),
    );
  }

  private async handleTournoiMenu(ctx: CommandContext<Context>): Promise<void> {
    try {
      // `/tournoi <id>` shows that specific tournament's live standings instead of the summary list.
      const idArg = ctx.match?.trim();
      const tournamentId = idArg ? parseInt(idArg, 10) : NaN;
      if (idArg && Number.isFinite(tournamentId) && tournamentId > 0) {
        await this.replyStandings(ctx, tournamentId);
        return;
      }

      const tournaments = await this.tournamentRepo.listTournaments();
      if (tournaments.length === 0) {
        await ctx.reply(
          "🏆 *MODE TOURNOI & CHAMPIONNAT*\n\nAucun tournoi officiel n'est en cours pour le moment.\n\nFormez votre équipe avec `/creerequipe <nom>` et préparez-vous pour la prochaine édition !",
          { parse_mode: 'Markdown' },
        );
        return;
      }

      let text = '🏆 *TOURNOIS OFFICIELS & CLASSEMENT*\n\n';
      for (const t of tournaments) {
        text += `• *${escapeMarkdown(t.name)}* (ID: \`${t.id}\`)\n  Statut: \`${t.status}\` | Manches: ${t.currentRound}/${t.totalRounds}\n`;
        text += `  📊 \`/tournoi ${t.id}\` pour voir le classement en direct\n\n`;
      }
      text += '💡 *Commandes Utiles :*\n';
      text += '• `/creerequipe <NomDuClan>` : Créer votre équipe\n';
      text += '• `/rejoindreequipe <Code>` : Rejoindre un clan\n';
      text += '• `/monequipe` : Voir votre clan et vos coéquipiers\n';
      text += '• `/inscrirefournoi <id>` : Inscrire votre clan au tournoi';

      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply('⚠️ Impossible de charger la liste des tournois.');
    }
  }

  private async replyStandings(ctx: Context, tournamentId: number): Promise<void> {
    const tournament = await this.tournamentRepo.getTournamentById(tournamentId);
    if (!tournament) {
      await ctx.reply('❌ Tournoi introuvable.');
      return;
    }

    const standings = await this.tournamentRepo.getTeamStandings(tournamentId);
    let text = `🏆 *${escapeMarkdown(tournament.name)}*\n`;
    text += `Statut: \`${tournament.status}\` | Manche ${tournament.currentRound}/${tournament.totalRounds}\n\n`;

    if (standings.length === 0) {
      text += "_Aucune équipe inscrite pour l'instant._";
    } else {
      text += '*Classement :*\n';
      standings.forEach((team, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
        text += `${medal} *${escapeMarkdown(team.name)}* — ${team.totalPoints} pts (${team.wins} victoires, ${team.members.length} membres)\n`;
      });
    }

    await ctx.reply(text, { parse_mode: 'Markdown' });
  }

  private async handleCreerEquipe(ctx: CommandContext<Context>): Promise<void> {
    const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
    if (!userId) return;

    const teamName = ctx.match?.trim();
    if (!teamName) {
      await ctx.reply(
        '⚠️ Veuillez indiquer le nom de votre équipe. Exemple: `/creerequipe Les Alpha Wolves`',
        {
          parse_mode: 'Markdown',
        },
      );
      return;
    }

    try {
      // A player can only ever be on one team at a time - otherwise a finished game would have
      // no unambiguous team to credit its points to (see `awardTournamentPoints`).
      const existing = await this.tournamentRepo.findTeamByPlayerId(userId);
      if (existing) {
        await ctx.reply(
          `⚠️ Vous faites déjà partie de l'équipe *${escapeMarkdown(existing.name)}*. Un joueur ne peut appartenir qu'à une seule équipe à la fois.`,
          { parse_mode: 'Markdown' },
        );
        return;
      }

      if (this.playerRepo) {
        await this.playerRepo.upsert(userId, {
          username: ctx.from?.username ?? null,
          displayName: ctx.from?.first_name ?? null,
        });
      }

      const randomCode = 'TAG' + Math.floor(1000 + Math.random() * 9000);
      const team = await this.tournamentRepo.createTeam(teamName, randomCode, userId);

      await ctx.reply(
        `🎉 *Équipe "${escapeMarkdown(team.name)}" créée avec succès !*\n\n` +
          `👑 Vous êtes le Capitaine.\n` +
          `🔑 *Code de recrutement :* \`${team.code}\`\n\n` +
          `Partagez ce code avec vos 3 coéquipiers pour qu'ils tapent :\n` +
          `\`/rejoindreequipe ${team.code}\`\n\n` +
          `Une fois à 4, le Capitaine peut inscrire l'équipe avec \`/inscrirefournoi <id>\`.`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      await ctx.reply("⚠️ Erreur lors de la création de l'équipe. Le nom ou le code existe déjà.");
    }
  }

  private async handleRejoindreEquipe(ctx: CommandContext<Context>): Promise<void> {
    const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
    if (!userId) return;

    const code = ctx.match?.trim().toUpperCase();
    if (!code) {
      await ctx.reply(
        "⚠️ Veuillez indiquer le code de l'équipe. Exemple: `/rejoindreequipe TAG1234`",
        {
          parse_mode: 'Markdown',
        },
      );
      return;
    }

    try {
      const existing = await this.tournamentRepo.findTeamByPlayerId(userId);
      if (existing) {
        await ctx.reply(
          `⚠️ Vous faites déjà partie de l'équipe *${escapeMarkdown(existing.name)}*. Un joueur ne peut appartenir qu'à une seule équipe à la fois.`,
          { parse_mode: 'Markdown' },
        );
        return;
      }

      if (this.playerRepo) {
        await this.playerRepo.upsert(userId, {
          username: ctx.from?.username ?? null,
          displayName: ctx.from?.first_name ?? null,
        });
      }

      const team = await this.tournamentRepo.findTeamByCode(code);
      if (!team) {
        await ctx.reply("❌ Code d'équipe introuvable.");
        return;
      }

      if (team.tournamentId) {
        await ctx.reply('⚠️ Cette équipe est déjà inscrite à un tournoi et ne peut plus recruter.');
        return;
      }

      if (team.members.length >= 4) {
        await ctx.reply('⚠️ Cette équipe compte déjà 4 membres (complète).');
        return;
      }

      await this.tournamentRepo.joinTeam(team.id, userId);
      await ctx.reply(
        `✅ *Vous avez rejoint l'équipe "${escapeMarkdown(team.name)}" !* (${team.members.length + 1}/4 membres)`,
        {
          parse_mode: 'Markdown',
        },
      );
    } catch (err) {
      await ctx.reply("⚠️ Erreur lors du recrutement dans l'équipe.");
    }
  }

  private async handleMonEquipe(ctx: Context): Promise<void> {
    const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
    if (!userId) return;

    const team = await this.tournamentRepo.findTeamByPlayerId(userId);
    if (!team) {
      await ctx.reply(
        "📋 Vous n'êtes dans aucune équipe. Tapez `/creerequipe <nom>` pour en créer une, ou `/rejoindreequipe <code>` pour en rejoindre une.",
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const captain = team.members.find((m) => m.isCaptain);
    const captainLabel = captain?.playerId === userId ? 'Vous' : `#${captain?.playerId ?? '?'}`;
    let text = `🛡️ *${escapeMarkdown(team.name)}*\n`;
    text += `🔑 Code : \`${team.code}\`\n`;
    text += `👥 Membres : ${team.members.length}/4\n`;
    text += `👑 Capitaine : ${captainLabel}\n\n`;

    if (team.tournamentId && team.tournament) {
      text += `🏆 Inscrite au tournoi *${escapeMarkdown(team.tournament.name)}* (\`${team.tournament.status}\`)\n`;
      text += `⭐ ${team.totalPoints} points cumulés | ${team.wins} victoires\n\n`;
      text += `Tapez \`/tournoi ${team.tournamentId}\` pour voir le classement complet.`;
    } else {
      text += "Cette équipe n'est inscrite à aucun tournoi pour le moment.\n";
      text += 'Le Capitaine peut utiliser `/inscrirefournoi <id>` une fois à 4 membres.';
    }

    await ctx.reply(text, { parse_mode: 'Markdown' });
  }

  private async handleInscrireTournoi(ctx: CommandContext<Context>): Promise<void> {
    const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
    if (!userId) return;

    const tourneyIdStr = ctx.match?.trim();
    const tourneyId = parseInt(tourneyIdStr || '0', 10);
    if (!tourneyId) {
      await ctx.reply("⚠️ Spécifiez l'ID du tournoi. Exemple: `/inscrirefournoi 1`", {
        parse_mode: 'Markdown',
      });
      return;
    }

    const team = await this.tournamentRepo.findTeamByPlayerId(userId);
    if (!team) {
      await ctx.reply(
        "❌ Vous n'êtes dans aucune équipe. Créez-en une avec `/creerequipe <nom>` d'abord.",
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const captain = team.members.find((m) => m.isCaptain);
    if (captain?.playerId !== userId) {
      await ctx.reply("⛔ Seul le Capitaine de l'équipe peut l'inscrire à un tournoi.");
      return;
    }

    if (team.tournamentId) {
      await ctx.reply('⚠️ Votre équipe est déjà inscrite à un tournoi.');
      return;
    }

    const tournament = await this.tournamentRepo.getTournamentDetails(tourneyId);
    if (!tournament) {
      await ctx.reply('❌ Tournoi introuvable.');
      return;
    }

    if (tournament.status !== 'REGISTRATION') {
      await ctx.reply(
        `⚠️ Les inscriptions pour *${escapeMarkdown(tournament.name)}* sont fermées (statut : \`${tournament.status}\`).`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    if (team.members.length !== tournament.teamSize) {
      await ctx.reply(
        `⚠️ Ce tournoi exige des équipes de ${tournament.teamSize} joueurs exactement. Votre équipe compte ${team.members.length} membre(s).`,
      );
      return;
    }

    if (tournament.teams.length >= tournament.maxTeams) {
      await ctx.reply(
        `⚠️ Ce tournoi a déjà atteint son nombre maximum d'équipes (${tournament.maxTeams}).`,
      );
      return;
    }

    await this.tournamentRepo.registerTeamToTournament(team.id, tourneyId);
    await ctx.reply(
      `✅ *${escapeMarkdown(team.name)}* est officiellement inscrite au tournoi *${escapeMarkdown(tournament.name)}* !\n\n` +
        `Chaque partie que vous jouerez pendant que le tournoi est en cours fera gagner (ou perdre) des points à votre équipe. Bonne chance !`,
      { parse_mode: 'Markdown' },
    );
  }
}
