/**
 * Step by step · the data, in one quiet card. Nothing bound: a drop target with "Choose a file", "Paste data" and the two
 * sample files. Something bound: just its chip and "Change". Every action goes through the shared session
 * (intakeFile, intakeText, useSample); problems are the engine's own words.
 */
import { useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent, TargetedEvent } from 'preact';
import type { Engine } from '@scasella/undefined-engine/types';
import { FileGlyph } from '../icons';
import { sampleFiles, type SampleId } from '../model/samples';
import { sessionFor } from '../start/session';
import { ACCEPT, DROP_NOTE, showOwnFileNote } from '../start/startView';
import './ZenData.css';

const PASTE_PLACEHOLDER = 'orderId,orderDate,customer,amount\n5001,2024-07-17,Puddlesworth Inc,279.34';

export function ZenData({ engine }: { engine: Engine }) {
  const s = sessionFor(engine);
  const [open, setOpen] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const intake = s.intake.value;
  const chip = s.fileChip.value;
  const canChange = s.canChange.value;
  const sampleId = s.sampleId.value;
  const bound = chip !== null;
  const showPicker = !bound || open;
  const ownNote = showOwnFileNote(s.source.value, engine.state.value.mode);

  const done = () => {
    setReading(null);
    // the picker closes once something is bound; a refusal keeps it open with the problem under it
    if (s.source.peek() !== 'none' && !s.intake.peek().problem) {
      setOpen(false);
      setPasting(false);
    }
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
    setReading('pasted data');
    void s.intakeText({ text }).finally(done);
  };
  const pickSample = (id: SampleId) => {
    if (!s.canChange.peek()) return;
    setReading(id);
    void s.useSample(id).finally(done);
  };

  const status = intake.busy || reading ? (reading === 'pasted data' ? 'Reading the pasted data…' : 'Reading the file…') : '';

  return (
    <section class="zd" aria-label="Your data">
      {bound && (
        <div class="zd__chip">
          <FileGlyph size={18} lines class="zd__chip-icon" />
          <span class="zd__chip-text fd-mono">{chip}</span>
          <button
            type="button"
            class="zd__change"
            aria-expanded={open}
            aria-controls="zd-picker"
            aria-disabled={!canChange || undefined}
            onClick={() => canChange && setOpen(!open)}
          >
            {open ? 'Close' : 'Change'}
          </button>
        </div>
      )}

      {showPicker && (
        <div id="zd-picker" class="zd__picker">
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
      {intake.problem && (
        <p class="zd__problem" role="alert">
          {intake.problem}
        </p>
      )}
      {ownNote && <p class="zd__note">{DROP_NOTE}</p>}
    </section>
  );
}
