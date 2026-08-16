import { PrismaClient } from '@prisma/client';
import { TournamentRepository } from '../src/infrastructure/persistence/tournament.repository.js';

async function main() {
  console.log('🚀 Démarrage de la simulation d\'un Tournoi...');
  const prisma = new PrismaClient();
  const repo = new TournamentRepository(prisma);

  // 1. Création du Tournoi
  const tournament = await repo.createTournament('Tournoi des Loups Supérieurs 🏆', 4, 4, 5);
  console.log(`✅ Tournoi créé : "${tournament.name}" (ID: ${tournament.id})`);

  // 2. Création des 4 Équipes de simulation
  const team1 = await repo.createTeam('Alpha Wolves 🐺', 'ALPHA' + Math.floor(Math.random() * 1000), 1001n, 'ALPHA');
  const team2 = await repo.createTeam('Les Chasseurs 🏹', 'HUNT' + Math.floor(Math.random() * 1000), 2001n, 'HUNT');
  const team3 = await repo.createTeam('Sorcières de la Nuit 🧹', 'WITCH' + Math.floor(Math.random() * 1000), 3001n, 'WITCH');
  const team4 = await repo.createTeam('Les Ombres 👥', 'SHAD' + Math.floor(Math.random() * 1000), 4001n, 'SHAD');

  console.log('✅ 4 Équipes créées avec succès !');

  // 3. Inscription des équipes au tournoi
  await repo.registerTeamToTournament(team1.id, tournament.id);
  await repo.registerTeamToTournament(team2.id, tournament.id);
  await repo.registerTeamToTournament(team3.id, tournament.id);
  await repo.registerTeamToTournament(team4.id, tournament.id);
  console.log('✅ 4 Équipes inscrites au Tournoi !');

  // 4. Lancement de la Manche 1
  await repo.updateTournamentStatus(tournament.id, 'IN_PROGRESS', 1);
  console.log('🚀 Manche 1 lancée !');

  // 5. Attribution de quelques points simulés pour la Manche 1
  await repo.addPointsToTeam(team1.id, 45, true);
  await repo.addPointsToTeam(team2.id, 30, false);
  await repo.addPointsToTeam(team3.id, 20, false);
  await repo.addPointsToTeam(team4.id, 10, false);
  console.log('📊 Points de la Manche 1 attribués !');

  const details = await repo.getTournamentDetails(tournament.id);
  console.log('\n--- 🏆 CLASSEMENT DU TOURNOI ---');
  details?.teams.forEach((t, index) => {
    console.log(`${index + 1}. ${t.name} (Code: ${t.code}) - ${t.totalPoints} pts [${t.wins} Victoire(s)]`);
  });

  await prisma.$disconnect();
  console.log('\n🎉 Simulation terminée avec succès ! Ouvrez http://localhost:4000 dans votre navigateur pour voir le tournoi dans l\'onglet "Tournois & Championnats".');
}

main().catch(console.error);
