// node scripts/record-draft.mjs   (npm run record:draft)
// Records ONE real live session of "Make the checks stricter" (src/door/start/draft.ts) and the answer it leads to, for the
// public demo and the landing:
//   bind orders.csv as the page does → select "What is our revenue by country?" → ask the AI to draft the checks → answer every
//   question it asks the way the site's own agreed definition does (paid orders only, after discount, highest first: PREFER below;
//   a question none of them fits gets its first choice) → approve every drafted check → Ask → require "committed".
// It writes src/door/model/recordedDraft.json (every model reply of the draft, verbatim and in order, with the answers given) and
// public/recordings/orders-draft.json (the answer's recorded session, keyed by the approved spec's hashes) and index.json.
// It drives the REAL session and draft controllers in headless Chrome against the vite DEV server, which talks to Codex with
// YOUR login (live mode).
// Honesty rule (as scripts/record.mjs and record-door.mjs): the tries, the rounds of questions, how the answers were chosen
// and whether the kept run's first answer draft was thrown out are printed AND written into both titles. A run in which the AI
// asked nothing is not kept (the demo is there to show it asking), and neither is one that does not commit; both count as tries.
import { readdirSync, writeFileSync } from 'node:fs';
import { launch, startServer } from './lib/drive.mjs';
process.chdir(new URL('../', import.meta.url).pathname); // paths below are relative to apps/site

const ID = 'orders-draft';
const QUESTION_ID = 'country';
const MAX_TRIES = 4;
const PORT = 5195;
const CHIP = 'orders.csv · 332 rows · 10 columns';
// The answers: the site's agreed definition (model/figures.ts AGREED: paid orders, after discount), then the largest first, exact totals.
const PREFER = ['paid', '(1 − discount)', 'after discount', 'less discount', 'descending revenue', 'exact'];
const HOW_ANSWERED = 'answered the way the site’s agreed definition reads (paid orders only, after discount, highest first)';
// Earlier runs of this script that are not in the kept run's own count (say them, so the curation is never hidden).
const EARLIER = process.env.RECORD_EARLIER ?? '';

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
  await page.reload();
  await page.waitForFunction(() => window.__undefined?.state.value.ready === true, null, { timeout: 60000 });
}

/** In the page: drive the page's own session and a draft controller whose model calls are logged, return what happened. */
const DRIVE = async ({ chip, questionId, prefer }) => {
  const engine = window.__undefined;
  const { sessionFor } = await import('/src/door/start/session.ts');
  const { createDraft, loadTypeScript } = await import('/src/door/start/draft.ts');
  const { LiveGenerator } = await import('/src/core/generator.ts');
  const { customSpec } = await import('/src/door/model/questions.ts');
  const { specKey } = await import('/src/door/start/recorded.ts');
  const s = sessionFor(engine);
  if (engine.state.value.mode !== 'live') return { fatal: `the engine is in ${engine.state.value.mode} mode: the Codex service is not up (run \`codex login\`, then retry)` };
  let bound = false;
  for (let i = 0; i < 100 && !bound; i++) {
    bound = await s.useSample('orders');
    if (!bound) await new Promise((r) => setTimeout(r, 200));
  }
  if (!bound) return { fatal: `could not bind orders.csv: ${s.intake.value.problem ?? 'the page stayed busy'}` };
  const t0 = Date.now();
  while (!document.body.innerText.includes(chip)) {
    if (Date.now() - t0 > 5000) return { fatal: `the page does not show "${chip}": not the page's own session?` };
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!(await s.selectQuestion(questionId))) return { fatal: `could not select question ${questionId}` };
  const q = s.question.value;

  // every model reply of the draft, by round, verbatim
  const rounds = [];
  const live = new LiveGenerator();
  const draft = createDraft(s, {
    generate: async (req, p, sig) => {
      const r = await live.generate(req, p, sig);
      rounds[rounds.length - 1].bodies.push(r.body);
      return r;
    },
    loadTs: loadTypeScript,
  });
  rounds.push({ bodies: [], answers: [] });
  await draft.start();
  let asked = 0;
  while (draft.state.value.phase === 'asking') {
    const qs = draft.state.value.draft.questions;
    asked += qs.length;
    // the option matching the most preferred phrases (in PREFER's order of weight), else the first
    const score = (o) => prefer.reduce((n, p, i) => n + (o.toLowerCase().includes(p.toLowerCase()) ? 2 ** (prefer.length - i) : 0), 0);
    const best = (opts) => opts.reduce((a, b) => (score(b) > score(a) ? b : a), opts[0]);
    const answers = qs.map((x) => ({ ask: x.ask, answer: x.options.length ? best(x.options) : 'Use the most common reading.' }));
    rounds[rounds.length - 1].answers = answers;
    rounds.push({ bodies: [], answers: [] });
    await draft.answer(answers);
  }
  const st = draft.state.value;
  if (st.phase !== 'review') return { outcome: `draft ${st.phase}${st.error ? `: ${st.error}` : ''}`, asked, rounds: rounds.length };
  if (!(await draft.approve())) return { outcome: 'the draft could not be approved', asked, rounds: rounds.length };
  const spec = engine.state.value.program.functions[q.fn]?.spec;
  const h = spec ? (([, specHash, testsHash]) => ({ specHash, testsHash }))((await specKey(spec)).split(' ')) : null;

  const okAsk = await s.ask();
  while (engine.state.value.busy) await new Promise((r) => setTimeout(r, 200));
  // the answer is accepted before the stress test has finished: the run is settled only when the outcome is no longer running
  const t1 = Date.now();
  while (['running', 'pending'].includes(s.outcome.value.kind) && Date.now() - t1 < 180000) await new Promise((r) => setTimeout(r, 250));
  const gen = engine.state.value.generation;
  const rec = engine.state.value.program.functions[q.fn];
  return {
    okAsk,
    asked,
    rounds: rounds.length,
    roundsData: rounds,
    question: q.text,
    fn: q.fn,
    base: customSpec(q, s.dataset.value),
    level: s.question.value?.level,
    outcome: s.outcome.value.kind,
    lead: s.answer.value.view?.lead ?? null,
    drafts: gen?.attempts.map((a) => (a.status === 'accepted' ? 'accepted' : `thrown out by ${a.candidate?.rejectedBy ?? a.status}`)) ?? [],
    firstThrownOut: gen?.attempts[0]?.status === 'rejected',
    key: h && rec && rec.specHash === h.specHash && rec.testsHash === h.testsHash ? { fn: q.fn, ...h } : null,
    exported: engine.exportRecording(),
  };
};

/** In the page: the recorded draft read back as the demo will read it, and a check that it installs the recorded answer's spec. */
const CHECK = async ({ rd, base }) => {
  const { recordedDraftReplays, recordedStory } = await import('/src/door/model/recordedDraft.ts');
  return { replays: await recordedDraftReplays(rd, base), story: !!recordedStory(rd) };
};

const srv = await startServer({ mode: 'dev', port: PORT });
const b = await launch();
let saved = false;
try {
  for (let attempt = 1; attempt <= MAX_TRIES && !saved; attempt++) {
    await openStart(b.page, srv.url);
    const r = await b.page.evaluate(DRIVE, { chip: CHIP, questionId: QUESTION_ID, prefer: PREFER });
    if (r.fatal) throw new Error(r.fatal);
    const lead = r.lead ? `${r.lead.name ?? ''} ${r.lead.num ?? ''}`.trim() : 'no answer';
    console.log(
      `${ID} try ${attempt}: asked ${r.asked} question(s) in ${r.rounds} round(s) → ${r.outcome}; answer drafts: ${r.drafts?.join(', ') || 'none'}; answer: ${lead}`,
    );
    if (r.outcome !== 'committed' || !r.key || r.asked === 0) continue;
    const sessions = r.exported.sessions.filter((x) => x.fn === r.key.fn && x.specHash === r.key.specHash && x.testsHash === r.key.testsHash && x.attempts.length > 0);
    if (sessions.length === 0) throw new Error('the exported recording holds no session for the approved spec');
    const tries = `${attempt} ${attempt === 1 ? 'try' : 'tries'}`;
    const how = `asked ${r.asked} question${r.asked === 1 ? '' : 's'} in ${r.rounds - 1} round${r.rounds - 1 === 1 ? '' : 's'}, ${HOW_ANSWERED}, every drafted check approved`;
    const first = r.firstThrownOut ? 'first answer draft thrown out' : 'first answer draft accepted';
    const title = `${ID}: orders.csv, "${r.question}", the AI drafted the checks (${how}); recorded live (${tries}${EARLIER ? `, ${EARLIER}` : ''}; ${r.drafts.length} answer draft${r.drafts.length === 1 ? '' : 's'}; ${first})`;
    const rd = {
      id: ID,
      title,
      sampleId: 'orders',
      questionId: QUESTION_ID,
      fn: r.fn,
      question: r.question,
      model: r.exported.sessions[0]?.model ?? r.exported.model ?? 'gpt-6-luna',
      recordedOn: new Date().toISOString().slice(0, 10),
      rounds: r.roundsData,
      key: { specHash: r.key.specHash, testsHash: r.key.testsHash },
    };
    const check = await b.page.evaluate(CHECK, { rd, base: r.base });
    if (!check.story || !check.replays) throw new Error('the recorded draft does not read back to the spec its answer was recorded for: not saving');
    writeFileSync('src/door/model/recordedDraft.json', JSON.stringify(rd, null, 1) + '\n');
    writeFileSync(`public/recordings/${ID}.json`, JSON.stringify({ ...r.exported, id: ID, title, sessions }, null, 1) + '\n');
    console.log(`  saved src/door/model/recordedDraft.json and public/recordings/${ID}.json: ${title}`);
    saved = true;
  }
  if (!saved) {
    console.error(`${ID}: no kept run in ${MAX_TRIES} tries; nothing saved`);
    process.exitCode = 1;
  }
  const names = readdirSync('public/recordings').filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  writeFileSync('public/recordings/index.json', JSON.stringify(names, null, 1) + '\n');
} finally {
  await b.close();
  srv.stop();
}
