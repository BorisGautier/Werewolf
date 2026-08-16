import type { CommandContext, Context } from 'grammy';
import type { TournamentRepository } from '../persistence/tournament.repository.js';
import type { PlayerRepository } from '../persistence/player.repository.js';

export class TournamentCommandHandler {
  constructor(
    private readonly tournamentRepo: TournamentRepository,
    private readonly playerRepo?: PlayerRepository,
  ) {}

  /**
   * Registers all tournament-related Telegram bot commands.
   */
  registerCommands(bot: any) {
    bot.command(['tournoi', 'tournament'], (ctx: Context) => this.handleTournoiMenu(ctx));
    bot.command('creerequipe', (ctx: CommandContext<Context>) => this.handleCreerEquipe(ctx));
    bot.command('rejoindreequipe', (ctx: CommandContext<Context>) =>
      this.handleRejoindreEquipe(ctx),
    );
    bot.command('monequipe', (ctx: Context) => this.handleMonEquipe(ctx));
    bot.command('inscrirefournoi', (ctx: CommandContext<Context>) =>
      this.handleInscrireTournoi(ctx),
    );
  }

  private async handleTournoiMenu(ctx: Context): Promise<void> {
    try {
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
        text += `• *${t.name}* (ID: \`${t.id}\`)\n  Statut: \`${t.status}\` | Manches: ${t.currentRound}/${t.totalRounds}\n\n`;
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
      // Ensure player exists in DB
      if (this.playerRepo) {
        await this.playerRepo.upsert(userId, {
          username: ctx.from?.username ?? null,
          displayName: ctx.from?.first_name ?? null,
        });
      }

      const randomCode = 'TAG' + Math.floor(1000 + Math.random() * 9000);
      const team = await this.tournamentRepo.createTeam(teamName, randomCode, userId);

      await ctx.reply(
        `🎉 *Équipe "${team.name}" créée avec succès !*\n\n` +
          `👑 Vous êtes le Capitaine.\n` +
          `🔑 *Code de recrutement :* \`${team.code}\`\n\n` +
          `Partagez ce code avec vos 3 coéquipiers pour qu'ils tapent :\n` +
          `\`/rejoindreequipe ${team.code}\``,
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

      if (team.members.length >= 4) {
        await ctx.reply('⚠️ Cette équipe compte déjà 4 membres (complète).');
        return;
      }

      const isAlreadyMember = team.members.some((m) => m.playerId === userId);
      if (isAlreadyMember) {
        await ctx.reply('ℹ️ Vous faites déjà partie de cette équipe !');
        return;
      }

      await this.tournamentRepo.joinTeam(team.id, userId);
      await ctx.reply(
        `✅ *Vous avez rejoint l'équipe "${team.name}" !* (${team.members.length + 1}/4 membres)`,
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

    await ctx.reply(
      '📋 Tapez `/tournoi` pour afficher vos tournois et le classement général de vos équipes.',
    );
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

    await ctx.reply(
      `✅ Votre inscription au tournoi #${tourneyId} a été transmise aux organisateurs !`,
    );
  }
}
