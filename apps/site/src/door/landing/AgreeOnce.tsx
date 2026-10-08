/** Landing · Fig. 3 "Agree once, held every time": the agreement × every version table (a real <table>). */
import { bundledOrders } from '../../data/orders';
import { CheckDisc, NotChecked, ThrownOut } from '../icons';
import { agreeOnceTable, CELL_WORD, OUTCOME_WORD, type AgreeTable, type CellStatus } from './agreeOnceView';
import './AgreeOnce.css';

let table: AgreeTable | null = null;
const getTable = (): AgreeTable => (table ??= agreeOnceTable(bundledOrders()));

function Cell({ status }: { status: CellStatus }) {
  const icon =
    status === 'pass' ? (
      <CheckDisc size={12} tone="mint" />
    ) : status === 'thrown-out' ? (
      <ThrownOut size={12} tone="trace" />
    ) : (
      <NotChecked size={12} color="#808A99" />
    );
  return (
    <td class="fd-once__cell">
      <span class={`fd-once__status fd-once__status--${status}`}>
        {icon}
        {CELL_WORD[status]}
      </span>
    </td>
  );
}

export function AgreeOnce() {
  const t = getTable();
  return (
    <section class="fd-once" aria-labelledby="agree-h">
      <div class="fd-once__wrap">
        <div class="fd-once__intro">
          <div class="fd-label-line">Fig. 3 · One agreement, every version</div>
          <h2 id="agree-h" class="fd-once__h">Agree once, held every time.</h2>
          <p class="fd-once__lede">
            Every version has to pass all of your rules. When you add a rule, the next version is held to it too. A rewrite that breaks an
            answer you locked is thrown out before you see it.
          </p>
          <p class="fd-once__small">Going back to an earlier version is saved as a new version. Nothing is erased.</p>
        </div>
        <div class="fd-once__board">
          <div class="fd-label-line fd-once__title" id="agree-table-t">
            {t.title}
          </div>
          {/* scrolls sideways on narrow screens: focusable so it can be scrolled from the keyboard */}
          <div class="fd-once__scroll" role="region" aria-labelledby="agree-table-t" tabIndex={0}>
            <table class="fd-once__table">
              <caption class="fd-once__caption">{t.caption}</caption>
              <thead>
                <tr>
                  <th scope="col" class="fd-once__corner">
                    Term of the agreement
                  </th>
                  {t.versions.map((v) => (
                    <th scope="col" class="fd-once__ver" key={v.name}>
                      <span class="fd-once__ver-name">{v.name}</span>
                      <span class="fd-once__ver-sub">{v.sub}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.terms.map((r) => (
                  <tr key={r.term}>
                    <th scope="row" class="fd-once__term">
                      {r.term}
                    </th>
                    {r.cells.map((c, i) => (
                      <Cell status={c} key={i} />
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row" class="fd-once__outcome-h">
                    <span class="fd-sr">What happened</span>
                  </th>
                  {t.versions.map((v) => (
                    <td class="fd-once__outcome" key={v.name}>
                      <span class={`fd-once__badge fd-once__badge--${v.outcome}`}>{OUTCOME_WORD[v.outcome]}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
