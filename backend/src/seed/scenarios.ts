/**
 * npm run seed:scenarios [-- --keep-data]
 * Re-seeds the demo data (so the time-based examples are exact), then applies the scripted demo steps and
 * prints the Example A and Example B results with a pass/fail check for each expected number.
 */
import { connectDB, disconnectDB } from '../config/db';
import { seedDatabase } from './seedDatabase';
import { runScenarios } from './runScenarios';

async function main() {
  await connectDB();
  if (!process.argv.includes('--keep-data')) {
    console.log('Re-seeding demo data (pass --keep-data to run against the current database)...');
    await seedDatabase();
  }
  const r = await runScenarios();
  console.log(r.lines.join('\n'));
  console.log('\nChecks:');
  for (const c of r.checks) console.log(`  [${c.passed ? 'PASS' : 'FAIL'}] ${c.name}: expected ${c.expected}, got ${c.actual}`);
  const failed = r.checks.filter((c) => !c.passed).length;
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  await disconnectDB();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error('Scenarios failed:', e);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
