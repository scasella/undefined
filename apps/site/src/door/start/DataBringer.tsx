/**
 * Bring a file (V3-Door-FirstRun 88-134): "Drop a file" / "Paste data" tabs and the two sample files. Every action
 * goes through the session (intakeFile, intakeText, useSample); problems are the engine's own words.
 *
 * At every width, once a file is bound (the sample is bound on arrival) the tabs, drop zone and sample cards fold away
 * behind the file's one-line chip and a "Change" button, so the Ask card and the check trace are what the page shows
 * (the fold itself is CSS, DataBringer.css; this file only decides when). "Change" opens the picker and moves focus
 * into it; closing it, or picking a file, puts focus back on the button, so it never falls to the page. The fold never
 * hides the demo's own-file note or a refusal: while either is showing, the picker stays open (startView.ts pickerFold, the
 * one rule, which Step by step's picker uses too). In the demo the picker also says, under the tabs and before anything is
 * dropped, what the demo cannot do with a file of your own (startView.ts DEMO_OWN_FILE_CAVEAT); a copy that runs on your
 * computer draws none of it.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent, TargetedEvent, TargetedKeyboardEvent } from 'preact';
import type { Engine } from '@scasella/undefined-engine/types';
import { Button } from '../components/LinkButton';
import { Segmented } from '../components/Segmented';
import { DropGrid, FileGlyph } from '../icons';
import { sampleFiles, type SampleId } from '../model/samples';
import { sessionFor } from './session';
import { ACCEPT, DROP_NOTE, ownFileCaveat, PASTE_NOTE, pickerFold, radioKeyIndex, sampleTag, showOwnFileNote } from './startView';
import './DataBringer.css';

type Mode = 'drop' | 'paste';
const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'drop', label: 'Drop a file' },
  { id: 'paste', label: 'Paste data' },
];
const tabId = (m: Mode): string => `fd-bring-tab-${m}`;
const panelId = (m: Mode): string => `fd-bring-panel-${m}`;
const PASTE_PLACEHOLDER = 'orderId,orderDate,customer,amount\n5001,2024-07-17,Puddlesworth Inc,279.34';
const PICKER_ID = 'fd-bring-picker';

export function DataBringer({ engine }: { engine: Engine }) {
  const s = sessionFor(engine);
  const mode = engine.state.value.mode;
  const [tab, setTab] = useState<Mode>('drop');
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const changeBtn = useRef<HTMLButtonElement>(null);
  // "Change" was pressed: once the picker is on screen, focus goes into it (on its selected tab)
  const wantFocus = useRef(false);
  const radios = useRef<Array<HTMLButtonElement | null>>([]);

  const intake = s.intake.value;
  const source = s.source.value;
  const sampleId = s.sampleId.value;
  const canChange = s.canChange.value;
  const ownNote = showOwnFileNote(source, mode);
  const samples = sampleFiles();
  const bound = source !== 'none';
  const caveat = ownFileCaveat(mode);
  // the picker folds away once something is bound, unless the note or a refusal below is what the viewer needs
  const fold = pickerFold({ bound, open, ownNote, problem: !!intake.problem });
  const { forced, folded } = fold;
  const chip = s.fileChip.value ?? s.fileName.value;
  // after a successful pick the picker closes again (a refusal keeps it open, with the problem under it). If focus was
  // in the picker it goes to the "Change" button, which is still there: a hidden control cannot keep it.
  const settle = () => {
    setReading(null);
    if (s.source.peek() === 'none' || s.intake.peek().problem) return;
    const stays = showOwnFileNote(s.source.peek(), engine.state.peek().mode);
    const active = document.activeElement;
    const inside = active === document.body || !!picker.current?.contains(active);
    setOpen(false);
    if (inside && !stays) requestAnimationFrame(() => changeBtn.current?.focus());
  };
  useEffect(() => {
    if (!open || !wantFocus.current) return;
    wantFocus.current = false;
    picker.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [open]);
  const onChange = () => {
    if (!canChange) return;
    if (folded) {
      wantFocus.current = true;
      setOpen(true);
    } else if (forced) {
      // on screen and cannot be closed (the note or a refusal is showing), whether or not it was also opened by hand: move in
      picker.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    } else {
      setOpen(false);
    }
  };

  const takeFile = (file: File | undefined | null) => {
    if (!file || !s.canChange.peek()) return;
    setReading(file.name);
    void s.intakeFile(file).finally(settle);
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
    void s.intakeText({ text }).finally(settle);
  };
  const pick = (id: SampleId) => {
    // settle() also clears `reading`, which a sample pick never sets: harmless, and it closes the picker on success
    if (s.canChange.peek()) void s.useSample(id).finally(settle);
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
    <div class={'fd-bring' + (folded ? ' is-folded' : '')}>
      {bound && (
        <div class="fd-bring__bound fd-card">
          <FileGlyph size={18} lines class="fd-bring__bound-icon" />
          <span class="fd-bring__bound-text fd-mono">{chip}</span>
          <button
            ref={changeBtn}
            type="button"
            class="fd-bring__change"
            aria-expanded={fold.expanded ? 'true' : 'false'}
            aria-controls={PICKER_ID}
            aria-disabled={canChange ? undefined : 'true'}
            onClick={onChange}
          >
            {fold.button}
          </button>
        </div>
      )}
      <div id={PICKER_ID} ref={picker} class="fd-bring__picker">
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
            <div class="fd-bring__zone-sub">TSV and JSON Lines work too · 1 MB at most.</div>
            <div class="fd-bring__zone-sub fd-bring__zone-hint">
              Excel (.xlsx) files can't be read yet. In Excel, choose File › Save As › CSV, then drop that file here.
            </div>
            <Button
              variant="secondary"
              class="fd-bring__choose"
              aria-disabled={canChange ? undefined : 'true'}
              onClick={() => canChange && input.current?.click()}
            >
              Choose a file
            </Button>
            <input ref={input} type="file" accept={ACCEPT} class="fd-sr" tabIndex={-1} aria-hidden="true" onChange={onPick} />
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
          </div>

          {caveat && <p class="fd-bring__caveat">{caveat}</p>}
          {/* what to do next comes after why (the caveat), as on Step by step: the reader meets the reason before the way out; one note, on either tab */}
          {ownNote && <p class="fd-bring__note">{tab === 'drop' ? DROP_NOTE : PASTE_NOTE}</p>}

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
          <div class="fd-label-line fd-bring__samples-h">Or start with a sample file</div>
          {samples.map((f, i) => {
            const on = f.id === sampleId;
            const focusable = current < 0 ? i === 0 : on;
            // in the demo, a sample none of whose questions has a recorded answer says so before it is picked (startView.ts sampleTag)
            const tag = sampleTag(mode, s.sampleAnswerable.value[f.id]);
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
                {tag && <span class="fd-bring__tag fd-mono">{tag}</span>}
                <span class="fd-bring__sample-desc">{f.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
