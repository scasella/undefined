/**
 * Step by step · the data, in one quiet card. Nothing bound: a drop target with "Choose a file", "Paste data" and the two
 * sample files. A sample bound (or any file, on a copy that runs on your computer): just its chip and "Change". Every action
 * goes through the shared session (intakeFile, intakeText, useSample); problems are the engine's own words.
 *
 * The demo (replay) says what it can and cannot do with a file of your own BEFORE you drop one: one caveat under the drop
 * zone (startView.ts DEMO_OWN_FILE_CAVEAT). Once your own data is bound the picker does not fold away (startView.ts
 * zenPickerFold, the Full view's pickerFold rule for the demo): the sample files stay in sight, with a short note directly
 * above them (a status region that is there before it has words, so what changes is spoken), and the forward button says what
 * it opens (flow.ts forwardLabel). A refusal holds the picker open in the demo too. A copy that runs on your computer draws
 * none of this and folds the picker as it always did.
 */
import { useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent, TargetedEvent } from 'preact';
import type { Engine } from '@scasella/undefined-engine/types';
import { FileGlyph } from '../icons';
import { sampleFiles, type SampleId } from '../model/samples';
import { sessionFor } from '../start/session';
import { ACCEPT, boundAnnouncement, ownFileCaveat, ownFileNote, ownFileRegion, PASTED_NAME, showOwnFileNote, zenPickerFold } from '../start/startView';
import { ZEN_CONTINUE_ID } from './flow';
import './ZenData.css';

const PASTE_PLACEHOLDER = 'orderId,orderDate,customer,amount\n5001,2024-07-17,Puddlesworth Inc,279.34';

export function ZenData({ engine }: { engine: Engine }) {
  const s = sessionFor(engine);
  const [open, setOpen] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [ready, setReady] = useState('');
  const depth = useRef(0);
  const picker = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const intake = s.intake.value;
  const chip = s.fileChip.value;
  const canChange = s.canChange.value;
  const sampleId = s.sampleId.value;
  const bound = chip !== null;
  const mode = engine.state.value.mode;
  const ownNote = showOwnFileNote(s.source.value, mode);
  const caveat = ownFileCaveat(mode);
  // folded behind the chip once something is bound, unless it was opened or (in the demo) the own-file note / a refusal is what is needed
  const fold = zenPickerFold({ bound, open, source: s.source.value, mode, problem: !!intake.problem });
  const showPicker = !fold.folded;

  const done = () => {
    setReading(null);
    // a refusal keeps the picker open with the problem under it; a bound file folds it (your own file in the demo keeps it open)
    if (s.source.peek() !== 'none' && !s.intake.peek().problem) {
      // the button that was pressed (a sample, "Use this data", the file chooser's) may go with the picker and would take the
      // focus with it, to <body>; and with your own file the picker stays but the next thing to do is the forward button:
      // send focus there on purpose, and say what is now bound
      const a = document.activeElement;
      const lost = !a || a === document.body || !!picker.current?.contains(a);
      setOpen(false);
      setPasting(false);
      setReady(boundAnnouncement(s.fileChip.peek(), showOwnFileNote(s.source.peek(), engine.state.peek().mode)));
      if (lost) requestAnimationFrame(() => document.getElementById(ZEN_CONTINUE_ID)?.focus());
    }
  };
  // "Change": opens a folded picker; while the picker cannot fold (your own file's note, a refusal) it moves in instead of
  // closing; opened by choice it closes
  const onChange = () => {
    if (!canChange) return;
    if (fold.forced) picker.current?.querySelector<HTMLElement>('.zd__zone button, .zd__zone textarea')?.focus();
    else setOpen(!open);
  };
  const takeFile = (file: File | undefined | null) => {
    if (!file || !s.canChange.peek()) return;
    setReading(file.name);
    void s.intakeFile(file).finally(done);
  };
  const onPick = (e: TargetedEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const f = el.files?.[0];
    el.value = '';
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
    setReading(PASTED_NAME);
    void s.intakeText({ text }).finally(done);
  };
  const pickSample = (id: SampleId) => {
    if (!s.canChange.peek()) return;
    setReading(id);
    void s.useSample(id).finally(done);
  };

  const status = intake.busy || reading ? (reading === PASTED_NAME ? 'Reading the pasted data…' : 'Reading the file…') : '';

  return (
    <section class="zd" aria-label="Your data">
      {bound && (
        <div class="zd__chip">
          <FileGlyph size={18} lines class="zd__chip-icon" />
          <span class="zd__chip-text fd-mono">{chip}</span>
          <button
            type="button"
            class="zd__change"
            aria-expanded={fold.expanded}
            aria-controls="zd-picker"
            aria-disabled={!canChange || undefined}
            onClick={onChange}
          >
            {fold.button}
          </button>
        </div>
      )}

      {showPicker && (
        <div id="zd-picker" class="zd__picker" ref={picker}>
          <div
            class={'zd__zone' + (over ? ' is-over' : '')}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {!pasting ? (
              <>
                <p class="zd__zone-h">Drop a CSV or JSON file here</p>
                <div class="zd__actions">
                  <button type="button" class="zd__btn" aria-disabled={!canChange || undefined} onClick={() => canChange && input.current?.click()}>
                    Choose a file
                  </button>
                  <button type="button" class="zd__btn" aria-disabled={!canChange || undefined} onClick={() => canChange && setPasting(true)}>
                    Paste data
                  </button>
                </div>
                <input ref={input} type="file" accept={ACCEPT} class="fd-sr" tabIndex={-1} aria-hidden="true" onChange={onPick} />
              </>
            ) : (
              <div class="zd__paste">
                <label for="zen-paste" class="zd__label">
                  Paste rows from a spreadsheet, header row first
                </label>
                <textarea
                  id="zen-paste"
                  rows={6}
                  spellcheck={false}
                  placeholder={PASTE_PLACEHOLDER}
                  class="zd__textarea fd-mono"
                  value={text}
                  onInput={(e) => setText(e.currentTarget.value)}
                />
                <div class="zd__actions">
                  <button type="button" class="zd__btn zd__btn--go" aria-disabled={!canChange || !text.trim() || undefined} onClick={() => text.trim() && usePaste()}>
                    Use this data
                  </button>
                  <button type="button" class="zd__btn" onClick={() => setPasting(false)}>
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
          {caveat && <p class="zd__caveat">{caveat}</p>}
          {ownFileRegion(mode) && (
            <div class="zd__own" role="status">
              {ownNote && <p class="zd__note">{ownFileNote(s.fileName.value)}</p>}
            </div>
          )}
          <div class="zd__samples" role="group" aria-label="Sample files">
            <span class="zd__or">or try a sample</span>
            {sampleFiles().map((f) => (
              <button
                key={f.id}
                type="button"
                class={'zd__sample fd-mono' + (f.id === sampleId ? ' is-on' : '')}
                aria-pressed={f.id === sampleId}
                aria-disabled={!canChange || undefined}
                onClick={() => pickSample(f.id)}
              >
                {f.filename}
              </button>
            ))}
          </div>
          <p class="zd__hint">Up to 20,000 rows, 1 MB. Excel files (.xlsx) are not read here: in Excel, choose File › Save As › CSV, then bring that.</p>
        </div>
      )}

      <div class="zd__status" role="status">
        {status}
      </div>
      <div class="fd-sr" role="status">
        {ready}
      </div>
      {intake.problem && (
        <p class="zd__problem" role="alert">
          {intake.problem}
        </p>
      )}
    </section>
  );
}
