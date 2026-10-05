/**
 * Just enough of a DOM for Preact to render a component in the node test environment, plus an HTML serializer and a
 * click helper. Test-only (no jsdom in this project); not a general DOM.
 */
type Listener = (e: unknown) => void;

export class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  attributes: { name: string; value: string }[] = [];
  style: Record<string, string> & { cssText?: string } = {};
  listeners = new Map<string, Listener>();
  data = '';
  open = false;
  constructor(
    readonly nodeType: number,
    readonly localName: string | undefined,
    readonly ownerDocument: FakeDocument,
  ) {}
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): FakeNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  appendChild(n: FakeNode): FakeNode {
    return this.insertBefore(n, null);
  }
  insertBefore(n: FakeNode, ref: FakeNode | null): FakeNode {
    n.parentNode?.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n);
    else this.childNodes.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
  removeChild(n: FakeNode): FakeNode {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  setAttribute(name: string, value: unknown): void {
    const v = String(value);
    const a = this.attributes.find((x) => x.name === name);
    if (a) a.value = v;
    else this.attributes.push({ name, value: v });
  }
  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((x) => x.name !== name);
  }
  getAttribute(name: string): string | null {
    return this.attributes.find((x) => x.name === name)?.value ?? null;
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, fn);
  }
  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }
  showModal(): void {
    this.open = true;
  }
  close(): void {
    this.open = false;
  }
  focus(): void {}
  get textContent(): string {
    return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join('');
  }
  /** Depth-first search by tag and (optional) text. */
  find(tag: string, text?: string): FakeNode | null {
    if (this.localName === tag && (text === undefined || this.textContent.includes(text))) return this;
    for (const c of this.childNodes) {
      const hit = c.find(tag, text);
      if (hit) return hit;
    }
    return null;
  }
  fire(type: string, extra: Record<string, unknown> = {}): void {
    const fn = this.listeners.get(type);
    if (!fn) throw new Error(`no ${type} listener on <${this.localName}>`);
    fn.call(this, { type, currentTarget: this, target: this, preventDefault() {}, ...extra });
  }
}

export class FakeDocument {
  createElementNS(_ns: string, tag: string): FakeNode {
    return new FakeNode(1, tag, this);
  }
  createElement(tag: string): FakeNode {
    return new FakeNode(1, tag, this);
  }
  createTextNode(text: unknown): FakeNode {
    const n = new FakeNode(3, undefined, this);
    n.data = String(text);
    return n;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Serialized markup: attributes in the order Preact set them, plus properties Preact set directly (value, etc.). */
export function toHtml(n: FakeNode): string {
  if (n.nodeType === 3) return esc(n.data);
  const own = n as unknown as Record<string, unknown>;
  const props = ['value', 'type', 'spellcheck', 'disabled', 'hidden', 'checked', 'placeholder', 'inputMode', 'autocomplete']
    .filter((k) => Object.prototype.hasOwnProperty.call(own, k) && own[k] !== undefined && own[k] !== false)
    .map((k) => ` .${k}="${esc(String(own[k]))}"`);
  const attrs = n.attributes.map((a) => ` ${a.name}="${esc(a.value).replace(/"/g, '&quot;')}"`);
  return `<${n.localName}${attrs.join('')}${props.join('')}>${n.childNodes.map(toHtml).join('')}</${n.localName}>`;
}
