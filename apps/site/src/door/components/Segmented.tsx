/**
 * The pill group. kind 'toggle': role=group of aria-pressed buttons (landing). kind 'tabs': role=tablist of
 * role=tab buttons with roving focus (←/→/Home/End), for first-run's "Drop a file" / "Paste data".
 */
import type { TargetedKeyboardEvent } from 'preact';
import './Segmented.css';

export interface SegmentedItem<T extends string = string> {
  id: T;
  label: string;
}

export interface SegmentedProps<T extends string = string> {
  items: ReadonlyArray<SegmentedItem<T>>;
  value: T;
  onChange: (id: T) => void;
  kind: 'toggle' | 'tabs';
  /** aria-label of the group / tablist. */
  label: string;
  /** tabs only: the id of the tabpanel each tab controls (e.g. id => `panel-${id}`). */
  controls?: (id: T) => string;
  /** tabs only: id for each tab button (so a tabpanel can use aria-labelledby). */
  tabId?: (id: T) => string;
  class?: string;
}

export function Segmented<T extends string>({ items, value, onChange, kind, label, controls, tabId, class: extra }: SegmentedProps<T>) {
  const tabs = kind === 'tabs';
  const onKeyDown = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!tabs) return;
    const i = items.findIndex((it) => it.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next]!.id);
    const btns = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    btns[next]?.focus();
  };
  return (
    <div role={tabs ? 'tablist' : 'group'} aria-label={label} class={'fd-seg' + (extra ? ' ' + extra : '')} onKeyDown={onKeyDown}>
      {items.map((it) => {
        const on = it.id === value;
        return tabs ? (
          <button
            key={it.id}
            type="button"
            role="tab"
            id={tabId?.(it.id)}
            aria-selected={on ? 'true' : 'false'}
            aria-controls={controls?.(it.id)}
            tabIndex={on ? 0 : -1}
            class={'fd-seg__item' + (on ? ' is-on' : '')}
            onClick={() => onChange(it.id)}
          >
            {it.label}
          </button>
        ) : (
          <button key={it.id} type="button" aria-pressed={on ? 'true' : 'false'} class={'fd-seg__item' + (on ? ' is-on' : '')} onClick={() => onChange(it.id)}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
