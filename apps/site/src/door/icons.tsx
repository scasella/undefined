/** Inline glyphs from the Round 3 boards. Decorative by default (aria-hidden); pass `title` to label one. */
interface IconProps {
  size?: number;
  class?: string;
  style?: any;
  title?: string;
}

const a11y = (title?: string) => (title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const });

/** Solid disc with a check. `tone`: green on light surfaces, mint on the dark trace. */
export function CheckDisc({ size = 16, tone = 'green', ...p }: IconProps & { tone?: 'green' | 'mint' }) {
  const fill = tone === 'mint' ? '#33C793' : '#17A36B';
  const stroke = tone === 'mint' ? '#07090C' : '#FFFFFF';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" class={p.class} style={p.style} {...a11y(p.title)}>
      <circle cx="8" cy="8" r="8" fill={fill} />
      <path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke={stroke} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** Square with a cross: a draft that was thrown out. `tone`: red on the dark trace, deep red on light surfaces. */
export function ThrownOut({ size = 16, tone = 'trace', ...p }: IconProps & { tone?: 'trace' | 'light' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" class={p.class} style={p.style} {...a11y(p.title)}>
      <rect width="16" height="16" rx="2" fill={tone === 'light' ? '#9E1C2A' : '#FF5A4E'} />
      <path d="M5 5l6 6M11 5l-6 6" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  );
}

/** Diamond with a question mark. `solid`: filled amber (light surfaces); outline: for the dark trace. */
export function AskDiamond({ size = 16, solid = false, ...p }: IconProps & { solid?: boolean }) {
  return solid ? (
    <svg width={size} height={size} viewBox="0 0 16 16" class={p.class} style={p.style} {...a11y(p.title)}>
      <path d="M8 0.8L15.2 8 8 15.2 0.8 8z" fill="#F6B73C" />
      <text x="8" y="11.2" text-anchor="middle" font-size="9" font-weight="700" fill="#0B0D12" font-family="Geist Variable, Geist, sans-serif">?</text>
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 16 16" class={p.class} style={p.style} {...a11y(p.title)}>
      <path d="M8 1.2L14.8 8 8 14.8 1.2 8z" fill="none" stroke="#FFB547" stroke-width="1.5" />
      <text x="8" y="11" text-anchor="middle" font-size="8" font-weight="700" fill="#FFB547" font-family="Geist Variable, Geist, sans-serif">?</text>
    </svg>
  );
}

/** Dashed circle: "not checked". */
export function NotChecked({ size = 16, color = '#5A6373', ...p }: IconProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" class={p.class} style={p.style} {...a11y(p.title)}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke={color} stroke-width="1.5" stroke-dasharray="2.4 2" />
    </svg>
  );
}

export function Lock({ size = 14, color = '#3D3BF3', ...p }: IconProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} stroke-width="1.6" class={p.class} style={p.style} {...a11y(p.title)}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

export function Arrow({ size = 16, ...p }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class={p.class} style={p.style} {...a11y(p.title)}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

export function Replay({ size = 16, ...p }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class={p.class} style={p.style} {...a11y(p.title)}>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" />
      <path d="M2.5 2.5v3h3" />
    </svg>
  );
}

export function FileGlyph({ size = 16, lines = false, ...p }: IconProps & { lines?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" class={p.class} style={p.style} {...a11y(p.title)}>
      <path d="M3 1.5h7l3 3v10H3z" />
      <path d={lines ? 'M10 1.5v3h3M5.5 8h5M5.5 10.5h5M5.5 13h3' : 'M10 1.5v3h3'} />
    </svg>
  );
}

/** The drop-zone glyph: a grid with an upload arrow. */
export function DropGrid({ size = 40, ...p }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" stroke="#3A4150" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class={p.class} style={p.style} {...a11y(p.title)}>
      <rect x="6" y="6" width="28" height="28" rx="6" />
      <path d="M6 15h28M6 24h28M15 6v28M24 6v28" stroke="#CDD2DB" />
      <path d="M20 30V18M15 22l5-5 5 5" stroke="#3D3BF3" stroke-width="1.8" />
    </svg>
  );
}

/** The wordmark glyph: rounded square with an indigo tick. */
export function Mark({ size = 20, ...p }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" class={p.class} style={p.style} {...a11y(p.title)}>
      <rect x="1" y="1" width="18" height="18" rx="6" stroke="#0B0D12" stroke-width="1.5" />
      <path d="M6 10.2l2.6 2.6L14 7.4" stroke="#3D3BF3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
