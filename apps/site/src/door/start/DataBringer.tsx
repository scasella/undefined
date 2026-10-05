/**
 * Bring a file (V3-Door-FirstRun 88-134): "Drop a file" / "Paste data" tabs and the two sample files. Every action
 * goes through the session (intakeFile, intakeText, useSample); problems are the engine's own words.
 */
import { useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent, TargetedEvent, TargetedKeyboardEvent } from 'preact';
import type { Engine } from '@scasella/undefined-engine/types';
import { Button } from '../components/LinkButton';
import { Segmented } from '../components/Segmented';
import { DropGrid, FileGlyph } from '../icons';
import { sampleFiles, type SampleId } from '../model/samples';
import { sessionFor } from './session';
import { ACCEPT, DROP_NOTE, PASTE_NOTE, radioKeyIndex, showOwnFileNote } from './startView';
import './DataBringer.css';

type Mode = 'drop' | 'paste';
const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'drop', label: 'Drop a file' },
  { id: 'paste', label: 'Paste data' },
];
const tabId = (m: Mode): string => `fd-bring-tab-${m}`;
const panelId = (m: Mode): string => `fd-bring-panel-${m}`;
const PASTE_PLACEHOLDER = 'orderId,orderDate,customer,amount\n5001,2024-07-17,Puddlesworth Inc,279.34';

export function DataBringer({ engine }: { engine: Engine }) {
  const s = sessionFor(engine);
  const mode = engine.state.value.mode;
  const [tab, setTab] = useState<Mode>('drop');
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const radios = useRef<Array<HTMLButtonElement | null>>([]);

  const intake = s.intake.value;
  const source = s.source.value;
  const sampleId = s.sampleId.value;
  const canChange = s.canChange.value;
  const ownNote = showOwnFileNote(source, mode);
  const samples = sampleFiles();

  const takeFile = (file: File | undefined | null) => {
    if (!file || !s.canChange.peek()) return;
    setReading(file.name);
    void s.intakeFile(file).finally(() => setReading(null));
  };
  const onPick = (e: TargetedEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const f = el.files?.[0];
    el.value = ''; // the same file can be picked again
    takeFile(f);
  };
  const onDragEnter = (e: TargetedDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    depth.current++;
    setOver(true);
  };
  const onDragOver = (e: TargetedDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = canChange ? 'copy' : 'none';
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDrop = (e: TargetedDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    takeFile(e.dataTransfer?.files?.[0]);
  };
  const usePaste = () => {
    if (!s.canChange.peek()) return;
    setReading('pasted data');
    void s.intakeText({ text }).finally(() => setReading(null));
  };
  const pick = (id: SampleId) => {
    if (s.canChange.peek()) void s.useSample(id);
  };
  const current = samples.findIndex((f) => f.id === sampleId);
  const onRadioKey = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    // from the focused radio (with none checked, focus sits on the first)
    const focused = radios.current.findIndex((el) => el !== null && el === document.activeElement);
    const next = radioKeyIndex(e.key, focused >= 0 ? focused : current, samples.length);
    if (next < 0) return;
    e.preventDefault();
    radios.current[next]?.focus();
    pick(samples[next]!.id);
  };

  const busyText =
    intake.busy || reading ? (reading === 'pasted data' ? 'Reading the pasted data…' : reading ? `Reading ${reading}…` : 'Loading the file…') : '';

  return (
    <div class="fd-bring">
      <div class="fd-bring__card fd-card">
        <Segmented
          items={MODES}
          value={tab}
          onChange={setTab}
          kind="tabs"
          label="How to bring your data"
          tabId={tabId}
          controls={panelId}
          class="fd-bring__tabs"
        />

        <div
          role="tabpanel"
          id={panelId('drop')}
          aria-labelledby={tabId('drop')}
          hidden={tab !== 'drop'}
          class={'fd-bring__zone' + (over ? ' is-over' : '')}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <DropGrid />
          <div class="fd-bring__zone-h">Drop a CSV or JSON export — up to 20,000 rows</div>
          <div class="fd-bring__zone-sub">TSV and JSON Lines work too · 1 MB at most · Saving from Excel? File › Save As › CSV.</div>
          <Button
            variant="secondary"
            class="fd-bring__choose"
            aria-disabled={canChange ? undefined : 'true'}
            onClick={() => canChange && input.current?.click()}
          >
            Choose a file
          </Button>
          <input ref={input} type="file" accept={ACCEPT} class="fd-sr" tabIndex={-1} aria-hidden="true" onChange={onPick} />
          {ownNote && <p class="fd-bring__note">{DROP_NOTE}</p>}
        </div>

        <div role="tabpanel" id={panelId('paste')} aria-labelledby={tabId('paste')} hidden={tab !== 'paste'} class="fd-bring__paste">
          <label for="paste-box" class="fd-bring__label">
            Paste rows copied from a spreadsheet, with the header row first
          </label>
          <textarea
            id="paste-box"
            rows={6}
            spellcheck={false}
            placeholder={PASTE_PLACEHOLDER}
            class="fd-bring__textarea fd-mono"
            value={text}
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <div class="fd-bring__paste-row">
            <Button variant="primary" aria-disabled={canChange ? undefined : 'true'} onClick={usePaste}>
              Use this data
            </Button>
            <span class="fd-bring__hint">Commas or tabs both work. Nothing is sent anywhere until you ask.</span>
          </div>
          {ownNote && <p class="fd-bring__note fd-bring__note--paste">{PASTE_NOTE}</p>}
        </div>

        <div class="fd-bring__status" role="status">
          {busyText}
        </div>
        {intake.problem && (
          <p class="fd-bring__problem" role="alert">
            {intake.problem}
          </p>
        )}
        {!intake.problem && intake.warnings.length > 0 && (
          <ul class="fd-bring__warnings" aria-label="Read with warnings">
            {intake.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      <div role="radiogroup" aria-label="Sample files" class="fd-bring__samples" onKeyDown={onRadioKey}>
        <div class="fd-eyebrow fd-bring__samples-h">OR START WITH A SAMPLE FILE</div>
        {samples.map((f, i) => {
          const on = f.id === sampleId;
          const focusable = current < 0 ? i === 0 : on;
          return (
            <button
              key={f.id}
              ref={(el) => {
                radios.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on ? 'true' : 'false'}
              aria-disabled={canChange ? undefined : 'true'}
              tabIndex={focusable ? 0 : -1}
              class={'fd-bring__sample' + (on ? ' is-on' : '')}
              onClick={() => pick(f.id)}
            >
              <span class="fd-bring__sample-top">
                <FileGlyph size={18} lines class="fd-bring__sample-icon" />
                <span class="fd-bring__sample-name fd-mono">{f.filename}</span>
                <span class="fd-bring__dot" aria-hidden="true" />
              </span>
              <span class="fd-bring__sample-meta fd-mono">{f.meta}</span>
              <span class="fd-bring__sample-desc">{f.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
