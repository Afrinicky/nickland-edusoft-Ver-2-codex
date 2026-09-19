// Nickland Edusoft — the school blueprints, and the drift between them.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
//   node test/host_blueprint.js
//
// Nothing here talks to Render. What it checks is the thing that actually goes
// wrong with a template: the root render.yaml is changed — a new pre-deploy
// step, a different health check — and the file that every school after today
// is made from still says the old thing. Then school number seven deploys
// differently from school number six and nobody knows why until it times out.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const root = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
const template = fs.readFileSync(path.join(ROOT, 'deploy/render-school.yaml'), 'utf8');

let pass = 0, fail = 0;
const ck = (n, c, got) => {
  c ? pass++ : fail++;
  console.log((c ? '✓ ' : '✗ ') + n + (c ? '' : '\n     got: ' + got));
};

// == What both files must say the same way ==
//
// Each of these is something that broke a deploy once, or would.
const together = [
  ['the pre-deploy that creates the tables', /preDeployCommand:\s*npm run host:provision -- --if-empty/],
  ['the start command', /startCommand:\s*node host\/server\.js/],
  ['the health check the platform waits on', /healthCheckPath:\s*\/api\/v1\/desk\/info/],
  ['one instance, because the cache is exact', /numInstances:\s*1/],
  ['the disk mounted where the files go', /mountPath:\s*\/var\/data/],
  ['EDUSOFT_DATA_DIR pointing at it', /key:\s*EDUSOFT_DATA_DIR[\s\S]{0,40}value:\s*\/var\/data/],
  ['DATABASE_URL set in the dashboard, not here', /key:\s*DATABASE_URL\s*\n\s*sync:\s*false/],
  ['a generated secret key', /key:\s*EDUSOFT_SECRET_KEY\s*\n\s*generateValue:\s*true/],
  ['the pool of three', /key:\s*DATABASE_POOL\s*\n\s*value:\s*"3"/],
  ['the cache TTL', /key:\s*DATABASE_CACHE_TTL_MS\s*\n\s*value:\s*"5000"/],
  ['Node 22', /key:\s*NODE_VERSION\s*\n\s*value:\s*"22"/],
  ['both applications built', /npm run build:web/],
];
for (const [what, re] of together) {
  ck(`root render.yaml and the school template agree on ${what}`,
    re.test(root) && re.test(template),
    `root ${re.test(root)}, template ${re.test(template)}`);
}

// == The template is a template ==
ck('the template names nobody — it cannot be applied by accident as a school',
  /SCHOOL-SLUG/.test(template) && /SCHOOL_SCHEMA/.test(template));

// == What the generator writes ==
const SLUG = 'zz-test-school';
const out = path.join(ROOT, 'deploy/schools', `${SLUG}.yaml`);
const run = (args) => execFileSync('node', [path.join(ROOT, 'scripts/add-school.mjs'), ...args],
  { cwd: ROOT, encoding: 'utf8' });

try {
  run(['--slug', SLUG, '--name', 'Test School', '--region', 'oregon', '--disk', '9']);
  const made = fs.readFileSync(out, 'utf8');

  ck('every placeholder is filled in', !/SCHOOL-SLUG|SCHOOL_SCHEMA/.test(made));
  ck('the service is named for the school', made.includes(`name: edusoft-${SLUG}`));
  ck('so is its disk — two schools cannot share one', made.includes(`name: edusoft-${SLUG}-files`));
  ck('the schema is the slug, said as an identifier', /value:\s*zz_test_school/.test(made), made.match(/DATABASE_SCHEMA[\s\S]{0,40}/));
  ck('the region asked for is the region written', /region:\s*oregon/.test(made));
  ck('so is the disk size', /sizeGB:\s*9/.test(made));
  ck('it says it was generated, and from what', /GENERATED from deploy\/render-school\.yaml/.test(made));
  ck('it carries the pre-deploy that creates the tables',
    /preDeployCommand:\s*npm run host:provision -- --if-empty/.test(made));

  // A second school must not quietly become the first one again.
  let refused = false;
  try { run(['--slug', SLUG, '--name', 'Test School']); }
  catch (e) { refused = /already exists/.test(String(e.stdout) + String(e.stderr)); }
  ck('writing over a school that already has a blueprint is refused', refused);

  let forced = false;
  try { run(['--slug', SLUG, '--name', 'Test School Renamed', '--force']); forced = true; } catch (_) {}
  ck('...unless --force, which is the deliberate way', forced &&
    fs.readFileSync(out, 'utf8').includes('Test School Renamed'));

  // Names that would become host names or SQL.
  for (const bad of ['Ave Maria', 'ave_maria', '-ave', 'a', 'école']) {
    let stopped = false;
    try { run(['--slug', bad, '--name', 'x']); } catch (_) { stopped = true; }
    ck(`"${bad}" is refused as a slug`, stopped);
  }
} finally {
  try { fs.unlinkSync(out); } catch (_) {}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
