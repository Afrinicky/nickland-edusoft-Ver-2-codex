// Provision a tenant (school) and print its API key.
//   node scripts/create-school.js "Ave Maria School"        (memory — dev only)
//   DATABASE_URL=… node scripts/create-school.js "Ave Maria School"
const { createStore } = require('../src/store');

(async () => {
  const name = process.argv.slice(2).join(' ') || 'New School';
  const store = createStore();
  const { school_id, api_key } = await store.createSchool({ name });
  console.log('School created:');
  console.log('  name:      ', name);
  console.log('  school_id: ', school_id);
  console.log('  api_key:   ', api_key);
  console.log('\nEnter these on the desktop under Settings → Cloud Sync.');
  if (store.kind === 'memory') console.log('\n(NOTE: memory store — set DATABASE_URL to persist to Neon.)');
  if (store.pool) await store.pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
