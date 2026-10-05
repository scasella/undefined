// node scripts/transcripts.mjs — writes docs/transcripts/<id>.md from the shipped recordings (public/recordings).
// Verbatim: each prompt is exactly what was sent to the model; the retry prompt contains the toolchain's diagnostics.
import { readFileSync, writeFileSync } from 'node:fs';
const SITE = new URL('../', import.meta.url).pathname; // apps/site/
const DOCS = new URL('../../../docs/', import.meta.url).pathname; // the repository's docs/
const ids = ['median', 'slugify', 'fibonacci', 'orders'];
for (const id of ids) {
  const rec = JSON.parse(readFileSync(`${SITE}public/recordings/${id}.json`, 'utf8'));
  const s = rec.sessions[0];
  const fence = (t, lang = '') => '```' + lang + '\n' + t.replace(/\n$/, '') + '\n```';
  let md = `# Transcript: ${id}\n\nA real session recorded live on ${rec.recordedAt.slice(0, 10)} with \`${rec.model}\` (effort \`${rec.effort}\`) via Codex CLI ${rec.codexVersion}.\n`;
  md += `Everything below is verbatim from \`public/recordings/${id}.json\`. The first call that triggered it: \`${(s.calls ?? ['?'])[0]}\`.\n\n`;
  md += `Spec the user had: ${s.spec ? '`' + s.spec.name + '(' + s.spec.params.map((p) => p.name + ': ' + p.type).join(', ') + ')' + (s.spec.returns ? ': ' + s.spec.returns : '') + '`' : 'none'}; doc: ${s.spec && s.spec.doc ? '"' + s.spec.doc + '"' : '(none)'}.\n\n`;
  s.attempts.forEach((a, i) => {
    md += `## Attempt ${i + 1}\n\n### What the model was sent (exact prompt)\n\n${fence(a.prompt)}\n\n### What the model returned (${(a.durationMs / 1000).toFixed(1)} s)\n\n`;
    md += `Note: ${a.notes}\n\n${fence(a.body, 'ts')}\n\n`;
    if (i < s.attempts.length - 1) md += `*The gates ran live in the browser and rejected this candidate; the diagnostics they produced are the \`PREVIOUS ATTEMPT\` section of the next prompt.*\n\n`;
    else md += `*This candidate passed the gates in the browser and was committed.*\n\n`;
  });
  writeFileSync(`${DOCS}transcripts/${id}.md`, md);
  console.log(id, s.attempts.length, 'attempts,', md.length, 'chars');
}
