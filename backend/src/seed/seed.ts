/** npm run seed [-- --if-empty] : (re)creates the demo database described in PART 4. */
import { connectDB, disconnectDB } from '../config/db';
import { env } from '../config/env';
import { seedDatabase } from './seedDatabase';
import { SEED_PASSWORD } from './data';

async function main() {
  const ifEmpty = process.argv.includes('--if-empty');
  await connectDB();
  console.log(`Seeding ${env.mongoUri.replace(/\/\/[^@]*@/, '//***@')}${ifEmpty ? ' (only if empty)' : ''}`);
  const r = await seedDatabase({ ifEmpty, log: (m) => console.log(m) });
  if (!r.skipped) {
    console.log('Seeded:', r.counts);
    console.log(`Accounts (password ${SEED_PASSWORD}): admin@example.com, manager@example.com, staff@example.com, supplier@example.com, supplier2@example.com`);
  }
  await disconnectDB();
}

main().catch(async (e) => {
  console.error('Seed failed:', e);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
