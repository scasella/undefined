/** The design's on/off switch: 40×24 track, 18px knob, indigo when on. The hit area is 44px without changing the look. */
import './Switch.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** aria-label (the switch has no visible label of its own). */
  label: string;
  disabled?: boolean;
  class?: string;
}

export function Switch({ checked, onChange, label, disabled, class: extra }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      disabled={disabled}
      class={'fd-switch' + (checked ? ' is-on' : '') + (extra ? ' ' + extra : '')}
      onClick={() => onChange(!checked)}
    >
      <span class="fd-switch__knob" aria-hidden="true" />
    </button>
  );
}
