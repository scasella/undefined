/**
 * Landing · "It asks instead of guessing" (#asks). Two example questions: a case the rules don't cover (what the
 * engine really does) and two rules that disagree (an illustration only: honesty rule 3, said in the small print).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { bundledOrders } from '../../data/orders';
import { Segmented } from '../components/Segmented';
import { Button } from '../components/LinkButton';
import { AskDiamond, CheckDisc, Lock } from '../icons';
import {
  ASK_MODES,
  ASKS_SMALL_PRINT,
  askQuestion,
  clashFigures,
  INITIAL_ASKS,
  pickOption,
  saveRule,
  showAgain,
  showMode,
  type AsksState,
  type ClashFigures,
} from './asksView';
import './Asks.css';

let figs: ClashFigures | null = null;
const getFigs = (): ClashFigures => (figs ??= clashFigures(bundledOrders()));

export function Asks() {
  const [s, setS] = useState<AsksState>(INITIAL_ASKS);
  const f = getFigs();
  const q = useMemo(() => askQuestion(s, f), [s, f]);
  const headRef = useRef<HTMLHeadingElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);
  // Focus follows the question: to the heading when the question changes or comes back, to the saved line on save.
  // `turn` counts user actions so the first render never steals focus.
  const turn = useRef(0);
  useEffect(() => {
    if (turn.current === 0) return;
    (s.saved ? savedRef.current : headRef.current)?.focus();
  }, [s.mode, s.saved]);
  const act = (next: AsksState) => {
    turn.current += 1;
    setS(next);
  };

  return (
    <section id="asks" class="fd-asks" aria-labelledby="asks-h">
      <div class="fd-asks__wrap">
        <div class="fd-asks__intro">
          <div class="fd-asks__eyebrow">WHEN THE RULES RUN OUT</div>
          <h2 id="asks-h" class="fd-asks__h">It asks instead of guessing.</h2>
          <p class="fd-asks__lede">
            The checks try your calculation on made-up tables full of awkward cases. When one lands on something your rules don't cover, or two of
            your rules can't both be true, everything stops and you get one plain question. Your answer becomes a house rule, with your name and the
            date on it.
          </p>
          <Segmented kind="toggle" label="Choose a kind of question" items={ASK_MODES} value={s.mode} onChange={(m) => act(showMode(s, m))} class="fd-asks__seg" />
          <p class="fd-asks__small">{ASKS_SMALL_PRINT}</p>
        </div>

        <div class="fd-asks__main">
          {!s.saved ? (
            <div role="group" aria-labelledby="q-head" class="fd-asks__q" key={q.mode}>
              <div class="fd-asks__q-eyebrow">
                <AskDiamond solid size={16} />A QUESTION ONLY YOU CAN ANSWER · Needs you
              </div>
              <h3 id="q-head" tabIndex={-1} ref={headRef} class="fd-asks__q-h">
                {q.head}
              </h3>
              <p class="fd-asks__q-body">{q.body}</p>

              {q.mode === 'gap' ? (
                <div class="fd-asks__case">
                  <div class="fd-asks__case-tag">MADE-UP · TABLE 47 OF 100</div>
                  <div class="fd-asks__case-row">Test Customer A · 2 orders · both refunded · draft gave $0.00</div>
                </div>
              ) : (
                <div class="fd-asks__clash">
                  <div class="fd-asks__side">
                    <span class="fd-asks__side-name">{f.rule}</span>
                    <span class="fd-asks__side-note">{f.ruleNote}</span>
                  </div>
                  <div class="fd-asks__ne" aria-hidden="true">
                    <span class="fd-asks__ne-line" />
                    <span class="fd-asks__ne-glyph">≠</span>
                  </div>
                  <div class="fd-asks__side">
                    <span class="fd-asks__side-name fd-asks__side-name--lock">
                      <Lock size={14} />
                      {f.lockedName} = <span class="fd-mono">{f.lockedAmount}</span>
                    </span>
                    <span class="fd-asks__side-note">{f.lockedNote}</span>
                  </div>
                </div>
              )}

              <fieldset class="fd-asks__fs">
                <legend class="fd-asks__legend">{q.legend}</legend>
                <div class="fd-asks__opts">
                  {q.options.map((o) => {
                    const on = o.id === q.selected;
                    return (
                      <label class={'fd-asks__opt' + (on ? ' is-on' : '')} key={o.id}>
                        <input type="radio" name={q.name} value={o.id} checked={on} onChange={() => act(pickOption(s, o.id))} class="fd-asks__radio" />
                        <span>{o.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <p class="fd-asks__preview" aria-live="polite">
                {q.preview}
              </p>
              <div class="fd-asks__actions">
                <Button variant="primary" onClick={() => act(saveRule(s))}>
                  Save as a house rule
                </Button>
                <span class="fd-asks__waiting">Waiting on you. No new answer is shown until you decide.</span>
              </div>
            </div>
          ) : (
            <div class="fd-asks__saved">
              <div class="fd-asks__saved-h" tabIndex={-1} ref={savedRef}>
                <CheckDisc size={20} />
                Saved as a house rule.
              </div>
              <p class="fd-asks__saved-rule">{q.savedRule}</p>
              <p class="fd-asks__saved-meta">
                Decided by you on 5 Oct 2026 · Re-checked with your rule. No new AI draft needed. · Checks resumed from made-up table 47
              </p>
              <button type="button" class="fd-asks__again" onClick={() => act(showAgain(s))}>
                Show the question again
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
