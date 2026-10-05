// node scripts/record-door.mjs   (npm run record:door)
// Records ONE real live session for the front door's seeded agreement and writes public/recordings/orders-agreement.json
// (+ public/recordings/index.json). It drives the REAL first-run session controller (src/door/start/session.ts,
// sessionFor(engine)) in headless Chrome against the vite DEV server, which talks to Codex with YOUR login (live mode):
//   bind orders.csv exactly as the page does (as `rows`) → select "Top 5 customers by revenue" (the session installs
//   the seeded agreement: 6 examples, 1 locked answer, 2 house rules) → Ask → require "committed".
// Honesty rule (as scripts/record.mjs): the number of tries and whether the kept run's first draft was thrown out are
// printed AND written into the recording's title, so the curation is never hidden. A run that does not commit (thrown
// out, a question only you can answer, it said no, a service problem) is not kept; after MAX_TRIES it gives up.
// Once the file is bundled, the replay site installs the agreement and shows "Full checks" for that question on its
// own (src/door/start/recorded.ts seedUsable: the recording matches the seeded spec's hashes).
import { readdirSync, writeFileSync } from 'node:fs';
import { launch, startServer } from './lib/drive.mjs';
process.chdir(new URL('../', import.meta.url).pathname); // paths below are relative to apps/site

const ID = 'orders-agreement';
const MAX_TRIES = 4;
const PORT = 5194;
const CHIP = 'orders.csv · 332 rows · 10 columns';

/** Open #/start on a fresh image (no stored program, no storage) and wait for the engine. */
async function openStart(page, url) {
  await page.goto(url + '#/start');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((res) => {
      const r = indexedDB.deleteDatabase('undefined-image');
      r.onsuccess = r.onerror = r.onblocked = () => res();
      setTimeout(res, 1500);
    });
  });
  await page.reload(); // same URL with a hash: goto would not reload
  await page.waitForFunction(() => window.__undefined?.state.value.ready === true, null, { timeout: 60000 });
}

/** In the page: drive the page's own session (same module instance the app uses), return what happened. */
const DRIVE = async ({ chip }) => {
  const engine = window.__undefined;
  const { sessionFor } = await import('/src/door/start/session.ts');
  const { specKey } = await import('/src/door/start/recorded.ts');
  const s = sessionFor(engine);
  if (engine.state.value.mode !== 'live') return { fatal: `the engine is in ${engine.state.value.mode} mode: the Codex service is not up (run \`codex login\`, then retry)` };
  // the page binds orders.csv itself on first visit; useSample is then a no-op (it returns false while that is busy)
  let bound = false;
  for (let i = 0; i < 100 && !bound; i++) {
    bound = await s.useSample('orders');
    if (!bound) await new Promise((r) => setTimeout(r, 200));
  }
  if (!bound) return { fatal: `could not bind orders.csv: ${s.intake.value.problem ?? 'the page stayed busy'}` };
  // the page renders the shared session: its file chip must be on screen (else this is not the page's session)
  const t0 = Date.now();
  while (!document.body.innerText.includes(chip)) {
    if (Date.now() - t0 > 5000) return { fatal: `the page does not show "${chip}": not the page's own session?` };
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!(await s.selectQuestion('top'))) return { fatal: 'could not select "Top 5 customers by revenue"' };
  const seed = s.seed.value;
  if (!seed || s.seedState.value !== 'installed') return { fatal: `the seeded agreement is not installed (seedState ${s.seedState.value})` };
  const level = s.question.value?.level;
  const asked = await s.ask();
  while (engine.state.value.busy) await new Promise((r) => setTimeout(r, 200));
  const st = engine.state.value;
  const rec = st.program.functions[seed.spec.name];
  const gen = st.generation;
  const seedKey = await specKey(seed.spec);
  return {
    asked,
    level,
    call: s.question.value?.call,
    outcome: s.outcome.value.kind,
    lead: s.answer.value.view?.lead ?? null,
    drafts: gen?.attempts.map((a) => (a.status === 'accepted' ? 'accepted' : `thrown out by ${a.candidate?.rejectedBy ?? a.status}`)) ?? [],
    firstThrownOut: gen?.attempts[0]?.status === 'rejected',
    key: rec ? { fn: seed.spec.name, specHash: rec.specHash, testsHash: rec.testsHash } : null,
    seedKey,
    exported: engine.exportRecording(),
  };
};

/** In the page: the recording to ship (recorded.ts agreementRecording) and a check that it replays this seed. */
const BUILD = async ({ exported, key, info }) => {
  const { agreementRecording, seedUsable } = await import('/src/door/start/recorded.ts');
  const { sessionFor } = await import('/src/door/start/session.ts');
  const rec = exported ? agreementRecording(exported, key, info) : null;
  const seed = sessionFor(window.__undefined).seed.value;
  const replays = rec && seed ? await seedUsable({ mode: 'replay', seed: seed.spec, program: { functions: {} }, recordings: [rec] }) : false;
  return { rec, replays };
};

const srv = await startServer({ mode: 'dev', port: PORT });
const b = await launch();
let saved = false;
try {
  for (let attempt = 1; attempt <= MAX_TRIES && !saved; attempt++) {
    await openStart(b.page, srv.url);
    const r = await b.page.evaluate(DRIVE, { chip: CHIP });
    if (r.fatal) throw new Error(r.fatal);
    const lead = r.lead ? `${r.lead.name ?? ''} ${r.lead.num ?? ''}`.trim() : 'no answer';
    console.log(`${ID} try ${attempt}: ${r.call} (${r.level} checks) → ${r.outcome}; drafts: ${r.drafts.join(', ') || 'none'}; first draft ${r.firstThrownOut ? 'thrown out' : 'accepted'}; answer: ${lead}`);
    if (r.outcome !== 'committed' || !r.key) continue;
    if (r.seedKey !== `${r.key.fn} ${r.key.specHash} ${r.key.testsHash}`) {
      throw new Error('the committed function is not the seeded spec (hashes differ): not saving');
    }
    const info = { id: ID, tries: attempt, drafts: r.drafts.length, firstThrownOut: r.firstThrownOut };
    const { rec, replays } = await b.page.evaluate(BUILD, { exported: r.exported, key: r.key, info });
    if (!rec) throw new Error('the exported recording holds no session for the seeded spec');
    if (!replays) throw new Error('the built recording would not replay the seeded agreement (hash mismatch): not saving');
    writeFileSync(`public/recordings/${ID}.json`, JSON.stringify(rec, null, 1) + '\n');
    console.log(`  saved public/recordings/${ID}.json (v${rec.version}, ${rec.sessions.length} session(s)): ${rec.title}`);
    saved = true;
  }
  if (!saved) {
    console.error(`${ID}: no committed run in ${MAX_TRIES} tries; nothing saved`);
    process.exitCode = 1;
  }
  const names = readdirSync('public/recordings').filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  writeFileSync('public/recordings/index.json', JSON.stringify(names, null, 1) + '\n');
} finally {
  await b.close();
  srv.stop();
}
