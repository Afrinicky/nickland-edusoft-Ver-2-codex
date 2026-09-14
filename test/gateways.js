// Nickland Edusoft — the desktop's payment gateway adapters.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/gateways.js       (requires Node >= 22.5)
//
// Four providers, one interface. What is under test is not that each adapter
// can talk to its provider — no live account exists here, and a test that
// needed one would be a test nobody runs — but the three things that go wrong
// when a second provider is added to a codebase that had one:
//
//   1. The registry hands back the wrong adapter, or the right adapter with
//      another provider's keys.
//   2. A provider that does not sign its callbacks is either believed (a
//      stranger can claim a payment) or refused outright (a real payment never
//      settles). Both are wrong; the answer is "go and ask".
//   3. The desktop and the cloud drift apart, and a school that set up Hubtel
//      on its desktop finds the portal does not offer Hubtel.
//
// Every provider is answered by a local HTTP server standing in for it, so the
// request each adapter actually builds is inspected — the URL, the headers,
// the encoding — rather than assumed.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`These tests need Node >= 22.5 (running ${process.versions.node}).`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { SCHEMA, runMigrations } = require(path.join(ROOT, 'electron/db/database.js'));
const { setSetting } = require(path.join(ROOT, 'electron/utils/idgen.js'));
const { getGateway, gatewayEnabled, signsCallbacks, ADAPTERS } = require(path.join(ROOT, 'electron/server/gateways'));
const { tokenFromUrl } = require(path.join(ROOT, 'electron/server/gateways/expresspay'));

let pass = 0, fail = 0;
const ck = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '✓' : '✗') + ' ' + name); };

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...a) => {
    db.exec('BEGIN');
    try { const r = fn(...a); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.exec(SCHEMA);
  runMigrations(db);
  return db;
}

// ── The provider, played by a local server ────────────────────────────────
// Records what it was asked, so a test can assert on the request and not only
// on what the adapter did with the reply.
const seen = [];
let reply = () => ({ status: 200, body: {} });

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const call = { method: req.method, url: req.url, headers: req.headers, raw };
    seen.push(call);
    const out = reply(call) || { status: 200, body: {} };
    const text = typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(text);
  });
});

const last = () => seen[seen.length - 1];

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // ── The registry ────────────────────────────────────────────────────────
  {
    const db = makeDb();
    ck('no gateway until one is chosen', getGateway(db) === null);
    setSetting(db, 'payment_gateway', 'hubtel');
    ck('the chosen provider is the one returned', getGateway(db).id === 'hubtel');
    ck('chosen but keyless is not enabled', gatewayEnabled(db) === false);

    setSetting(db, 'payment_gateway', 'nonesuch');
    ck('an unknown provider is no provider, not a crash', getGateway(db) === null);

    // A Paystack key must not make a Hubtel school look configured. This is
    // the mistake the settings screen used to make and the dashboards read.
    setSetting(db, 'payment_gateway', 'hubtel');
    setSetting(db, 'paystack_secret_key', 'sk_test_x');
    ck("another provider's key does not configure this one", gatewayEnabled(db) === false);
    setSetting(db, 'hubtel_client_id', 'id');
    setSetting(db, 'hubtel_client_secret', 'secret');
    setSetting(db, 'hubtel_merchant_account', '2019204');
    ck('its own three credentials do', gatewayEnabled(db) === true);
  }

  // ── Who signs, and what that means ──────────────────────────────────────
  {
    ck('Paystack signs', signsCallbacks(ADAPTERS.paystack) === true);
    ck('Flutterwave signs (a shared hash)', signsCallbacks(ADAPTERS.flutterwave) === true);
    ck('Hubtel does not', signsCallbacks(ADAPTERS.hubtel) === false);
    ck('ExpressPay does not', signsCallbacks(ADAPTERS.expresspay) === false);
    ck('no gateway signs nothing', signsCallbacks(null) === false);

    const db = makeDb();
    // The two unsigned ones must never claim a body is authentic, whatever is
    // in it. The webhook route asks `signsCallbacks` first precisely because
    // these two always answer false.
    ck('Hubtel refuses to vouch for a body',
      ADAPTERS.hubtel.verifyWebhook(db, 'anything', '{}') === false);
    ck('ExpressPay refuses to vouch for a body',
      ADAPTERS.expresspay.verifyWebhook(db, 'anything', '{}') === false);
  }

  // ── Flutterwave ─────────────────────────────────────────────────────────
  {
    const db = makeDb();
    setSetting(db, 'payment_gateway', 'flutterwave');
    setSetting(db, 'flutterwave_secret_key', 'FLWSECK-test');
    setSetting(db, 'flutterwave_secret_hash', 'the-shared-hash');
    setSetting(db, 'flutterwave_base_url', base);
    const g = getGateway(db);
    ck('Flutterwave is configured by its secret key', gatewayEnabled(db) === true);

    reply = () => ({ status: 200, body: { status: 'success', data: { link: `${base}/pay/abc` } } });
    const init = await g.initialize(db, { amount: 120.5, email: 'p@x.gh', reference: 'NE-7-aa' });
    ck('Flutterwave checkout returns the payment link',
      init.ok && init.authorization_url === `${base}/pay/abc`);
    ck('…sent as a bearer token', last().headers.authorization === 'Bearer FLWSECK-test');
    ck('…under OUR reference as tx_ref', JSON.parse(last().raw).tx_ref === 'NE-7-aa');
    // Flutterwave quotes major units. Sending pesewas would charge a parent
    // a hundred times the fee, which is the one bug worth a test of its own.
    ck('…with the amount in cedis, not pesewas', JSON.parse(last().raw).amount === '120.5');

    reply = () => ({ status: 200, body: { data: { status: 'successful', amount: 120.5, currency: 'GHS' } } });
    const v = await g.verify(db, 'NE-7-aa');
    ck('Flutterwave verify reports paid', v.ok && v.paid === true && v.amount === 120.5);
    ck('…asked by tx_ref, not by the provider’s id',
      last().url.includes('verify_by_reference') && last().url.includes('tx_ref=NE-7-aa'));

    reply = () => ({ status: 200, body: { data: { status: 'failed', amount: 120.5 } } });
    ck('…and a failed one is not paid', (await g.verify(db, 'NE-7-aa')).paid === false);

    ck('the shared hash is what authenticates a delivery',
      g.verifyWebhook(db, 'the-shared-hash', '{}') === true);
    ck('a wrong hash does not', g.verifyWebhook(db, 'not-it', '{}') === false);
    ck('a hash of the wrong length does not', g.verifyWebhook(db, 'the-shared-hash-longer', '{}') === false);
    setSetting(db, 'flutterwave_secret_hash', '');
    ck('and with no hash set, nothing is authentic', g.verifyWebhook(db, '', '{}') === false);

    const body = { event: 'charge.completed', data: { tx_ref: 'NE-7-aa', status: 'successful' } };
    ck('a successful delivery names our reference',
      g.webhookReference(body) === 'NE-7-aa' && g.webhookIsSuccess(body) === true);
    ck('a failed one is not success',
      g.webhookIsSuccess({ data: { tx_ref: 'x', status: 'failed' } }) === false);
  }

  // ── Hubtel ──────────────────────────────────────────────────────────────
  {
    const db = makeDb();
    setSetting(db, 'payment_gateway', 'hubtel');
    setSetting(db, 'hubtel_client_id', 'API-ID');
    setSetting(db, 'hubtel_client_secret', 'API-KEY');
    setSetting(db, 'hubtel_merchant_account', '2019204');
    setSetting(db, 'hubtel_base_url', base);
    setSetting(db, 'hubtel_status_url', base);
    const g = getGateway(db);

    reply = () => ({ status: 200, body: { data: { checkoutDirectUrl: `${base}/c/1`, clientReference: 'NE-9-bb', checkoutId: 'chk1' } } });
    const init = await g.initialize(db, { amount: 60, reference: 'NE-9-bb' });
    ck('Hubtel checkout returns the direct URL', init.ok && init.authorization_url === `${base}/c/1`);
    ck('…authenticated with Basic id:key',
      last().headers.authorization === `Basic ${Buffer.from('API-ID:API-KEY').toString('base64')}`);
    ck('…naming the merchant account the money lands in',
      JSON.parse(last().raw).merchantAccountNumber === '2019204');

    // Hubtel's status API answers with a list as often as with an object.
    reply = () => ({ status: 200, body: { data: [{ status: 'Paid', amount: 60 }] } });
    const v = await g.verify(db, 'NE-9-bb');
    ck('Hubtel verify reads a list answer', v.ok && v.paid === true && v.amount === 60);
    ck('…asked by our client reference',
      last().url.includes('/transactions/2019204/status') && last().url.includes('clientReference=NE-9-bb'));

    reply = () => ({ status: 200, body: { data: { status: 'Pending' } } });
    ck('a pending Hubtel payment is not paid', (await g.verify(db, 'NE-9-bb')).paid === false);

    // The callback is a nudge. It may name a reference; it may not say the
    // payment worked, because nothing signed it.
    const cb = { Data: { ClientReference: 'NE-9-bb', Status: 'Success', TransactionId: 'T1' } };
    ck('a Hubtel callback names the reference to go and check',
      g.webhookReference(cb) === 'NE-9-bb');
    ck('…and a nameless one names nothing', g.webhookReference({}) === null);
  }

  // ── ExpressPay ──────────────────────────────────────────────────────────
  {
    const db = makeDb();
    setSetting(db, 'payment_gateway', 'expresspay');
    setSetting(db, 'expresspay_merchant_id', 'M-1');
    setSetting(db, 'expresspay_api_key', 'K-1');
    setSetting(db, 'expresspay_base_url', base);
    const g = getGateway(db);

    reply = () => ({ status: 200, body: { status: 1, token: 'TKN-77' } });
    const init = await g.initialize(db, { amount: 45, reference: 'NE-11-cc' });
    ck('ExpressPay checkout builds the URL around the token',
      init.ok && init.authorization_url === `${base}/checkout.php?token=TKN-77`);
    // Form-encoded, with hyphenated field names. Sending JSON here gets a
    // "bad request" that looks like a wrong key.
    ck('…posted form-encoded',
      String(last().headers['content-type']).startsWith('application/x-www-form-urlencoded'));
    ck('…with hyphenated credentials in the body',
      last().raw.includes('merchant-id=M-1') && last().raw.includes('api-key=K-1'));
    ck('…and the amount to two decimals', last().raw.includes('amount=45.00'));

    ck('the token can be read back out of the stored URL',
      tokenFromUrl(init.authorization_url) === 'TKN-77');
    ck('…and a URL without one yields nothing', tokenFromUrl(`${base}/checkout.php`) === '');

    // Asking by order id is not something ExpressPay supports, and saying so
    // beats a confusing 400 from the provider.
    const noToken = await g.verify(db, 'NE-11-cc');
    ck('verify without a token refuses plainly',
      noToken.ok === false && noToken.error === 'expresspay_needs_token');

    reply = () => ({ status: 200, body: { result: 1, 'result-text': 'Approved', amount: 45, currency: 'GHS' } });
    const v = await g.verify(db, 'NE-11-cc', { token: 'TKN-77' });
    ck('result 1 is paid', v.ok && v.paid === true && v.amount === 45);
    ck('…queried by token', last().raw.includes('token=TKN-77'));

    reply = () => ({ status: 200, body: { result: 3, 'result-text': 'Pending' } });
    const p = await g.verify(db, 'NE-11-cc', { token: 'TKN-77' });
    // A mobile-money payer who has not yet approved the prompt sits here for a
    // minute or two. Reporting that as a decline tells a parent their money
    // failed when it has not.
    ck('result 3 is pending, not failed', p.ok === true && p.paid === false && p.pending === true);

    reply = () => ({ status: 200, body: { result: 2, 'result-text': 'Declined' } });
    const d = await g.verify(db, 'NE-11-cc', { token: 'TKN-77' });
    ck('result 2 is declined and not pending', d.paid === false && d.pending === false);

    ck('a callback names the order id',
      g.webhookReference({ 'order-id': 'NE-11-cc', token: 'TKN-77' }) === 'NE-11-cc');
  }

  // ── Not reachable is not "declined" ─────────────────────────────────────
  {
    const db = makeDb();
    setSetting(db, 'payment_gateway', 'flutterwave');
    setSetting(db, 'flutterwave_secret_key', 'k');
    setSetting(db, 'flutterwave_base_url', 'http://127.0.0.1:9');   // discard port
    const v = await getGateway(db).verify(db, 'NE-1-zz');
    // `ok: false` and not `paid: false`. The difference is whether the caller
    // marks the intent rejected or leaves it alone to be asked again.
    ck('an unreachable provider is an error, never a verdict',
      v.ok === false && v.paid === undefined);
  }

  // ── Desktop and cloud offer the same providers ──────────────────────────
  {
    const dir = path.join(ROOT, 'cloud-python/app/gateways');
    const cloud = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.py') && !['__init__.py', 'base.py', 'sms.py'].includes(f))
      .map((f) => f.replace(/\.py$/, ''))
      .sort();
    const desktop = Object.keys(ADAPTERS).sort();
    // A school that set Hubtel up on its desktop and then moves to the portal
    // must not be told to change provider, and vice versa.
    ck(`the same four providers on both sides (${desktop.join(', ')})`,
      JSON.stringify(cloud) === JSON.stringify(desktop));

    // Visa and Mastercard on both sides, and the SAME answer on both sides: a
    // parent told at the desktop that their Mastercard works must not be told
    // otherwise by the portal serving the same school.
    for (const id of desktop) {
      const spec = ADAPTERS[id];
      ck(`${id} takes Visa and Mastercard`,
        (spec.cardBrands || []).includes('visa') && (spec.cardBrands || []).includes('mastercard'));
      const py = fs.readFileSync(path.join(dir, `${id}.py`), 'utf8');
      const declared = (py.match(/card_brands = \(([^)]*)\)/) || [, ''])[1]
        .split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean).sort();
      ck(`…and the cloud's ${id} agrees exactly (${declared.join(', ')})`,
        JSON.stringify(declared) === JSON.stringify([...(spec.cardBrands || [])].sort()));
    }

    // The settings screen is the only way a school picks one, so a provider
    // the registry knows and the screen does not is a provider nobody can use.
    const screen = fs.readFileSync(
      path.join(ROOT, 'src/renderer/src/pages/Settings/Payments.jsx'), 'utf8');
    ck('and every one of them is offered by the settings screen',
      desktop.every((id) => screen.includes(`id: '${id}'`)));

    // Written, never read back. A secret a screen can display is a secret a
    // screenshot can carry out of the building.
    const admin = fs.readFileSync(path.join(ROOT, 'electron/server/admin_api.js'), 'utf8');
    const writeOnly = admin.split('const SETTINGS_WRITE_ONLY = [')[1].split('];')[0];
    for (const key of ['paystack_secret_key', 'flutterwave_secret_key', 'flutterwave_secret_hash',
      'hubtel_client_id', 'hubtel_client_secret', 'expresspay_api_key']) {
      ck(`${key} is never read back`, writeOnly.includes(`'${key}'`));
    }
  }

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
