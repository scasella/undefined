/**
 * The check trace (always dark). One presentational component, two feeds:
 *  - script: the landing's slowed-down illustration (model/traceScript), replayed by bumping `script.run`;
 *  - live: lanes from the real engine (model/lanes), each playing a short sweep once when it settles.
 * The static styles are the animation's end state, so reduced motion still shows the right result.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CSSProperties, JSX } from 'preact';
import { AskDiamond, CheckDisc, Lock, NotChecked, ThrownOut } from '../icons';
import type { GhostView, HeaderView, LaneLink, LaneState, LaneView } from '../model/lanes';
import { gridPenLeft, laneMotion, LIVE_TIMING, panelMotion, suffix, type Scenario, type Sfx, type Timing } from '../model/traceScript';
import './CheckTrace.css';

export interface CheckTraceProps {
  lanes: LaneView[];
  /** Earlier drafts that were thrown out, shown faded above the lanes. */
  ghost?: GhostView | GhostView[] | null;
  header: HeaderView;
  footer: { text: string; meta: string };
  /** The landing's scripted playback; lanes[i] plays with scenario.lanes[i]'s timing. */
  script?: { scenario: Scenario; run: number } | null;
  /** The aria-live sentence. */
  liveText: string;
  /** Outline ring on lanes whose link matches (the agreement rail's chips). */
  highlight?: LaneLink | null;
  /** Script: when the playback reaches tEnd. Live: once the run is done and its last lane has played. */
  onSettled?: () => void;
  /** The label above the lanes ('DRAFT 2'); none on the first-run page. */
  draftLabel?: string;
  /** The list's aria-label. */
  listLabel?: string;
  /** Live feed only: the timer word while the run is going ('checking…'). The run panel says 'drafting…' while the AI is still writing. */
  runningText?: string;
}

const SETTLED: ReadonlySet<LaneState> = new Set(['passed', 'failed', 'stopped']);

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const css = (animation?: string, extra?: CSSProperties): CSSProperties | undefined =>
  animation || extra ? { ...(extra ?? {}), ...(animation ? { animation } : {}) } : undefined;

export function CheckTrace(p: CheckTraceProps) {
  const script = p.script ?? null;
  const sx: Sfx = script ? suffix(script.run) : 'a';

  // live: remember each lane's last state; a lane plays its short sweep only on the render where it settles
  const seen = useRef(new Map<string, { state: LaneState; play: boolean }>());
  const mounted = useRef(false);
  const liveTiming = (key: string, state: LaneState): Timing | null => {
    const rec = seen.current.get(key);
    if (!rec || rec.state !== state) {
      const play = mounted.current && !!rec && SETTLED.has(state);
      seen.current.set(key, { state, play });
      return play ? LIVE_TIMING : null;
    }
    return rec.play ? LIVE_TIMING : null;
  };
  const doneRec = useRef<{ done: boolean; play: boolean }>({ done: !!p.header.done, play: false });
  if (!script && doneRec.current.done !== !!p.header.done) doneRec.current = { done: !!p.header.done, play: mounted.current && !!p.header.done };
  useEffect(() => {
    mounted.current = true;
  }, []);

  // onSettled
  const settledCb = useRef(p.onSettled);
  settledCb.current = p.onSettled;
  const scriptKey = script ? `${script.scenario.id}:${script.run}` : null;
  // Script only: the playback that has reached its end state. Until then the verdict text stays out of the accessibility
  // tree (it is opacity 0 on screen); once there, the 'checking…' line and the header's left text leave it instead. The
  // live feed is always at rest: its text is real state, not playback.
  const [restKey, setRestKey] = useState<string | null>(null);
  const atRest = !script || restKey === scriptKey;
  useEffect(() => {
    if (!script) return;
    const ms = prefersReducedMotion() ? 0 : script.scenario.tEnd * 1000;
    const t = setTimeout(() => {
      setRestKey(scriptKey);
      settledCb.current?.();
    }, ms);
    return () => clearTimeout(t);
  }, [scriptKey]);
  const liveDone = !script && !!p.header.done;
  useEffect(() => {
    if (!liveDone) return;
    const t = setTimeout(() => settledCb.current?.(), prefersReducedMotion() ? 0 : LIVE_TIMING.dur * 1000);
    return () => clearTimeout(t);
  }, [liveDone]);

  const h = p.header;
  // panel motion: scripted at tEnd, or live at 0 on the render where the run finished
  const pm = script
    ? panelMotion(script.scenario.tEnd, sx, { seal: h.tone === 'pass', ghost: !!script.scenario.ghost })
    : doneRec.current.play
      ? panelMotion(0, 'a', { seal: h.tone === 'pass', ghost: false })
      : {};
  const showVerdict = !!(h.done && h.verdict);
  const ghosts = p.ghost ? (Array.isArray(p.ghost) ? p.ghost : [p.ghost]) : [];

  // text that is faded out on screen is not read out either (aria-hidden): the header's left text once the verdict is up,
  // and, in the playback, the verdict until it has landed and 'checking…' once it has
  const verdictUp = showVerdict && atRest;
  return (
    <div class="fd-trace">
      {showVerdict && h.tone === 'pass' && <span aria-hidden="true" class="fd-trace__seal" style={css(pm.seal)} />}
      <div class="fd-trace__head fd-trace__mono">
        <div class="fd-trace__hl">
          <span
            aria-hidden={verdictUp ? 'true' : undefined}
            class={`fd-trace__hl-a${showVerdict ? ' fd-trace__hidden' : ''}`}
            style={css(showVerdict ? pm.hdrLeft : undefined)}
          >
            {h.left}
          </span>
          {showVerdict && (
            <span
              aria-hidden={atRest ? undefined : 'true'}
              class={`fd-trace__hl-b${h.tone === 'ask' ? ' fd-trace__hl-b--ask' : h.tone === 'fail' ? ' fd-trace__hl-b--fail' : ''}`}
              style={css(pm.hdrVerdict)}
            >
              {h.verdict}
            </span>
          )}
        </div>
        <div class="fd-trace__timer">
          {(script || h.running) && (
            <span
              aria-hidden={script && atRest ? 'true' : undefined}
              class={`fd-trace__timer-a${h.running && !script ? '' : ' fd-trace__hidden'}`}
              style={css(script ? pm.timerRunning : undefined)}
            >
              {script ? 'checking…' : (p.runningText ?? 'checking…')}
            </span>
          )}
          {!(h.running && !script) && (
            <span
              aria-hidden={atRest ? undefined : 'true'}
              class={`fd-trace__timer-b${h.tone === 'ask' && h.done ? ' fd-trace__timer-b--ask' : ''}`}
              style={css(h.done ? pm.timerDone : undefined)}
            >
              {h.right}
            </span>
          )}
        </div>
      </div>

      {ghosts.map((gh, gi) => (
        <div key={`${gh.title}:${gi}`}>
          <div class="fd-trace__draft">{gh.title}</div>
          <ol aria-label={`${gh.title.charAt(0)}${gh.title.slice(1).toLowerCase()} checks`} class="fd-trace__list fd-trace__ghost-list" style={css(pm.ghost)}>
            {gh.lanes.map((lane, i) => {
              const t = script?.scenario.ghost?.[i] ?? null;
              return <Lane key={`${lane.num}:${lane.state}`} lane={lane} timing={t} sx={sx} compact highlight={null} />;
            })}
          </ol>
          <div class="fd-trace__ghost-note" style={css(pm.ghostNote)}>
            <ThrownOut size={16} />
            <span>
              {gh.note.map((s, i) => (s.mono ? <span key={i} class="fd-trace__mono">{s.text}</span> : s.text))}
            </span>
          </div>
        </div>
      ))}

      {p.draftLabel && <div class="fd-trace__draft">{p.draftLabel}</div>}
      <ol aria-label={p.listLabel ?? 'Checks that run before you see the answer'} class="fd-trace__list">
        {p.lanes.map((lane, i) => {
          const t = script ? (script.scenario.lanes[i] ?? null) : liveTiming(lane.num, lane.state);
          return <Lane key={script ? lane.num : `${lane.num}:${lane.state}`} lane={lane} timing={t} sx={sx} highlight={p.highlight ?? null} />;
        })}
      </ol>

      <div class="fd-trace__foot">
        <p class="fd-trace__foot-text">{p.footer.text}</p>
        <span class="fd-trace__foot-meta fd-trace__mono">{p.footer.meta}</span>
      </div>
      <div aria-live="polite" class="fd-sr">
        {atRest ? p.liveText : ''}
      </div>
    </div>
  );
}

interface LaneProps {
  lane: LaneView;
  timing: Timing | null;
  sx: Sfx;
  highlight: LaneLink | null;
  compact?: boolean;
}

function Lane({ lane, timing, sx, highlight, compact }: LaneProps) {
  const m = laneMotion(lane, timing, sx);
  const st = lane.state;
  const settled = SETTLED.has(st);
  const isOff = st === 'off';
  const dim = isOff || st === 'skipped';
  const stopAt = st === 'stopped' && lane.kind === 'grid' ? Math.min(lane.stopAt ?? lane.cells, lane.cells) : null;
  const missedFrom = lane.kind === 'stress' ? lane.cells - (lane.missed ?? 0) : lane.cells;
  const progressDone = st === 'running' && lane.progress ? Math.round((lane.progress.done / Math.max(1, lane.progress.total)) * lane.cells) : 0;

  const cells: JSX.Element[] = [];
  for (let i = 0; i < lane.cells; i++) {
    let cls = 'fd-cell';
    let text = '';
    if (!settled) cls += i < progressDone ? '' : ' fd-cell--wait';
    else if (st === 'failed') {
      cls += ' fd-cell--fail';
      text = '×';
    } else if (stopAt !== null && i === stopAt - 1) cls += ' fd-cell--ask';
    else if (stopAt !== null && i > stopAt - 1) cls += ' fd-cell--wait';
    else if (st === 'stopped' && stopAt === null) cls += ' fd-cell--ask';
    else if (i >= missedFrom) {
      cls += ' fd-cell--ask';
      text = '?';
    }
    cells.push(
      <span key={i} class={cls} style={css(m.cells[i])}>
        {text}
      </span>,
    );
  }

  const liCls = [
    'fd-lane',
    compact ? 'fd-lane--compact' : '',
    st === 'stopped' ? 'fd-lane--stopped' : '',
    st === 'running' ? 'fd-lane--running' : '',
    highlight && lane.link === highlight ? 'fd-lane--hl' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const steps: string[] = [];
  if (settled && st !== 'failed') for (let k = 0; k <= m.steps; k++) steps.push(`${k}/${lane.cells}`);
  const doneTone = st === 'failed' ? ' fd-lane__done--fail' : st === 'stopped' ? ' fd-lane__done--ask' : '';

  return (
    <li aria-label={lane.aria} class={liCls} style={css(m.li)}>
      <div class={`fd-lane__label${dim ? ' fd-lane__label--dim' : ''}`}>
        <span class="fd-lane__num">{lane.num}</span>
        {lane.lock && <Lock size={12} color="#B9C2FF" />}
        <span>{lane.label}</span>
      </div>
      <div class="fd-lane__mid">
        {!isOff && lane.cells > 0 && (
          <div aria-hidden="true" class={`fd-lane__cells${lane.kind === 'grid' ? ' fd-lane__cells--grid' : lane.kind === 'stress' ? ' fd-lane__cells--stress' : ''}`}>
            {cells}
            {settled && (
              <span
                class={`fd-lane__pen${st === 'stopped' ? ' fd-lane__pen--stop' : ''}`}
                style={css(m.pen, st === 'stopped' ? { left: gridPenLeft(stopAt ?? 47) } : undefined)}
              >
                <span />
              </span>
            )}
          </div>
        )}
        {st === 'failed' && <span aria-hidden="true" class="fd-lane__strike" style={css(m.strike)} />}
        {isOff && lane.offNote && <span class="fd-lane__off">{lane.offNote}</span>}
      </div>
      <div class="fd-lane__count fd-trace__mono">
        {!settled && st !== 'running' && (
          <span class="fd-lane__wait">
            {isOff && <NotChecked size={12} color="#808A99" />}
            {lane.idle ?? ''}
          </span>
        )}
        {/* the motion's own text ("Waiting", the 0/n … n/n strip) only exists while it plays: it is never read out */}
        {settled && m.wait && (
          <span aria-hidden="true" class="fd-lane__wait fd-trace__hidden" style={css(m.wait)}>
            Waiting
          </span>
        )}
        {st === 'running' && <span class="fd-lane__run">{lane.progress ? `${lane.progress.done}/${lane.progress.total}` : 'checking…'}</span>}
        {settled && st !== 'failed' && m.run && (
          <span aria-hidden="true" class="fd-lane__run fd-trace__hidden" style={css(m.run)}>
            <span class="fd-lane__strip" style={css(m.strip)}>
              {steps.map((s, k) => (
                <span key={k}>{s}</span>
              ))}
            </span>
          </span>
        )}
        {settled && (
          <span class={`fd-lane__done${doneTone}`} style={css(m.done)}>
            <span class="fd-lane__line1">
              {lane.done && <span>{lane.done}</span>}
              {lane.glyph === 'pass' && <CheckDisc size={12} tone="mint" />}
              {lane.glyph === 'fail' && <ThrownOut size={12} />}
              {lane.glyph === 'ask' && <AskDiamond size={12} style={css(m.ask)} />}
              {lane.word && <span>{lane.word}</span>}
            </span>
            {lane.line2 && (
              <span class={`fd-lane__line2 fd-lane__line2--${lane.line2Tone ?? (st === 'failed' ? 'fail' : 'pass')}`}>
                {lane.line2Glyph && <AskDiamond size={12} />}
                {lane.line2}
              </span>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
