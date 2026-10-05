/** Anchor and button in the front door's three styles (.fd-btn--primary / --secondary / --ghost-link, components.css). */
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { Arrow } from '../icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost-link';

const cls = (variant: ButtonVariant, extra?: unknown): string =>
  `fd-btn fd-btn--${variant}${typeof extra === 'string' && extra ? ' ' + extra : ''}`;

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'icon' | 'href' | 'role'> & {
  href: string;
  variant?: ButtonVariant;
  /** 'arrow' appends the design's arrow glyph after the label. */
  icon?: 'arrow';
  children?: ComponentChildren;
};

export function LinkButton({ href, variant = 'primary', icon, children, class: extra, ...rest }: AnchorProps) {
  return (
    <a {...rest} href={href} class={cls(variant, extra)}>
      {children}
      {icon === 'arrow' && <Arrow />}
    </a>
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'type' | 'disabled'> & {
  variant?: ButtonVariant;
  icon?: 'arrow';
  type?: 'button' | 'submit';
  disabled?: boolean;
  children?: ComponentChildren;
};

export function Button({ variant = 'primary', icon, type = 'button', children, class: extra, ...rest }: ButtonProps) {
  return (
    <button type={type} class={cls(variant, extra)} {...rest}>
      {children}
      {icon === 'arrow' && <Arrow />}
    </button>
  );
}
