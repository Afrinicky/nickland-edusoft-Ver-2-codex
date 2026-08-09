// Parent web-portal test: login → me → children → profile update, against the
// real cloud server (in-memory store) with a projected parent_auth snapshot.
const http = require('http');
const crypto = require('crypto');
const { createServer } = require('../src/server');
const { createMemoryStore } = require('../src/store');

function makeHash(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const d = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${d}`;
}
function req(base, method, p, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(base + p);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode }); } });
    });
    if (data) r.write(data); r.end();
  });
}

let pass = 0, fail = 0; const ck = (n, c) => { (c ? pass++ : fail++); console.log((c ? '✓' : '✗') + ' ' + n); };

(async () => {
  const store = createMemoryStore();
  const { school_id } = await store.createSchool({ name: 'Ave Maria School' });
  // Projected auth + a child snapshot (as if pushed from a desktop).
  await store.upsertSnapshot(school_id, { entity_type: 'parent_auth', entity_key: 'parent:1', uuid: 'u1', version: 1,
    payload: { parent_id: 1, full_name: 'Papa', phone: '233244123456', email: 'papa@mail.com', password_hash: makeHash('pass12'), is_active: 1, student_keys: ['student:1'] } });
  await store.upsertSnapshot(school_id, { entity_type: 'student_snapshot', entity_key: 'student:1', uuid: 'u2', version: 1,
    payload: { student_id: 1, name: 'ANSU MONA', index_number: 'AVE/17/00001', class_name: 'Basic 5', term: 'Third Term', fees: { billed: 410, paid: 150, balance: 260 }, canteen: { unpaid_days: 3, amount_owed: 15 }, attendance: { present: 40, absent: 2, total: 42 }, report: { term: 'Third Term', subjects: [{ subject: 'Mathematics', total: 82, grade: 'Advanced' }], average: 78.5, rank: 3, number_on_roll: 30, remarks: 'Good work' }, updated_at: new Date().toISOString() } });
  await store.upsertSnapshot(school_id, { entity_type: 'receipt', entity_key: 'receipt:FE/26/00001', uuid: 'u3', version: 1,
    payload: { receipt_number: 'FE/26/00001', student_id: 1, amount: 150, category: 'fees', payment_method: 'Cash', date: '2026-07-30' } });
  await store.upsertSnapshot(school_id, { entity_type: 'announcement', entity_key: 'announcement:1', uuid: 'a1', version: 1,
    payload: { id: 1, title: 'PTA Meeting', body: 'Saturday 10am', audience: 'all', is_active: 1, created_at: '2026-07-29' } });
  await store.upsertSnapshot(school_id, { entity_type: 'announcement', entity_key: 'announcement:2', uuid: 'a2', version: 1,
    payload: { id: 2, title: 'Well done', body: 'Great result', audience: 'student', student_id: 1, is_active: 1, created_at: '2026-07-30' } });
  await store.upsertSnapshot(school_id, { entity_type: 'announcement', entity_key: 'announcement:3', uuid: 'a3', version: 1,
    payload: { id: 3, title: 'Not yours', body: 'Other kid', audience: 'student', student_id: 99, is_active: 1, created_at: '2026-07-30' } });

  const server = createServer(store);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  // Site is served
  let r = await new Promise(res => http.get(base + '/', x => { let d=''; x.on('data',c=>d+=c); x.on('end',()=>res({status:x.statusCode,body:d})); }));
  ck('website served at /', r.status === 200 && /Parent Portal/.test(r.body));

  r = await req(base, 'GET', '/api/v1/portal/schools');
  ck('schools list includes tenant', r.json.ok && r.json.schools.some(s => s.school_id === school_id));

  r = await req(base, 'POST', '/api/v1/portal/login', { body: { school_id, identifier: '0244123456', password: 'wrong' } });
  ck('wrong password → 401', r.status === 401);

  r = await req(base, 'POST', '/api/v1/portal/login', { body: { school_id, identifier: '0244123456', password: 'pass12' } });
  ck('login (by phone) ok + token', r.status === 200 && r.json.ok && r.json.token);
  const token = r.json.token;

  r = await req(base, 'GET', '/api/v1/portal/children');
  ck('children without token → 401', r.status === 401);

  r = await req(base, 'GET', '/api/v1/portal/me', { token });
  ck('me returns parent + school', r.json.ok && r.json.parent.full_name === 'Papa' && r.json.school.name === 'Ave Maria School');

  r = await req(base, 'GET', '/api/v1/portal/children', { token });
  ck('children returns the linked child w/ balance 260', r.json.ok && r.json.children.length === 1 && r.json.children[0].fees.balance === 260);
  ck('child snapshot carries attendance + performance', r.json.children[0].attendance.present === 40 && r.json.children[0].report.average === 78.5);

  r = await req(base, 'GET', '/api/v1/portal/receipts', { token });
  ck('receipts returns the child receipt', r.json.ok && r.json.receipts.length === 1 && r.json.receipts[0].receipt_number === 'FE/26/00001');

  r = await req(base, 'GET', '/api/v1/portal/announcements', { token });
  const titles = (r.json.announcements || []).map(a => a.title);
  ck('announcements: school-wide + own child only (not others)', r.json.ok && titles.includes('PTA Meeting') && titles.includes('Well done') && !titles.includes('Not yours'));

  r = await req(base, 'POST', '/api/v1/portal/profile', { token, body: { full_name: 'Papa Ansu', email: 'new@mail.com' } });
  ck('profile update ok', r.json.ok);
  const changes = await store.changesSince(school_id, '0');
  ck('profile update queued a parent_update for the desktop', changes.changes.some(c => c.type === 'parent_update' && c.payload.full_name === 'Papa Ansu'));
  r = await req(base, 'GET', '/api/v1/portal/me', { token });
  ck('me reflects updated name immediately', r.json.parent.full_name === 'Papa Ansu' && r.json.parent.email === 'new@mail.com');

  // Login by email works too
  r = await req(base, 'POST', '/api/v1/portal/login', { body: { school_id, identifier: 'new@mail.com', password: 'pass12' } });
  ck('login by (updated) email ok', r.status === 200 && r.json.ok);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
