import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Testing PostgreSQL database connection and pmLynchVote column...');
  const group = await prisma.group.upsert({
    where: { telegramId: -100123456789n },
    create: {
      telegramId: -100123456789n,
      title: 'Group Test Fix',
      pmLynchVote: true,
    },
    update: {
      pmLynchVote: true,
    },
    include: {
      disabledRoles: true,
    },
  });

  console.log('✅ DATABASE UPSERT SUCCESSFUL!');
  console.log('   - Group ID:', group.id);
  console.log('   - Telegram ID:', group.telegramId.toString());
  console.log('   - pmLynchVote column value:', group.pmLynchVote);
}

main()
  .catch((err) => {
    console.error('❌ Database query failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
