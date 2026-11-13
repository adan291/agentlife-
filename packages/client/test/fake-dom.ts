/**
 * A very small DOM for tests: enough of `Document` for the render functions in `src/ui` (createElement,
 * createTextNode, createDocumentFragment, append, replaceChildren, textContent, className, dataset, attributes,
 * click handlers). There is no HTML parser on purpose: whatever a render function puts in a text node must
 * come out escaped by `html()`, so a test can show that raw HTML in the input never becomes an element.
 */

export class FakeNode {
  parent: FakeNode | null = null;
  children: FakeNode[] = [];
  constructor(readonly tagName: string) {}

  get isText(): boolean {
    return this.tagName === "#text";
  }
}

export class FakeText extends FakeNode {
  constructor(public data: string) {
    super("#text");
  }
}

const VOID = new Set(["br", "hr", "img", "input"]);

export class FakeElement extends FakeNode {
  className = "";
  id = "";
  value = "";
  rows = 0;
  maxLength = 0;
  placeholder = "";
  hidden = false;
  disabled = false;
  type = "";
  title = "";
  tabIndex = 0;
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly style = { props: new Map<string, string>(), setProperty(k: string, v: string) { this.props.set(k, v); } };
  private readonly handlers = new Map<string, ((ev: unknown) => void)[]>();

  get textContent(): string {
    return this.children.map((c) => (c instanceof FakeText ? c.data : c instanceof FakeElement || c instanceof FakeFragment ? c.textContent : "")).join("");
  }
  set textContent(value: string) {
    this.replaceChildren(...(value === "" ? [] : [new FakeText(value)]));
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  focus(): void {}
  /** Runs the listeners of an event, as the browser does when the user types (`input`). `ev` is what the listeners get. */
  fire(type: string, ev: unknown = {}): void {
    for (const fn of this.handlers.get(type) ?? []) fn(ev);
  }

  appendChild<T extends FakeNode>(child: T): T {
    return appendTo(this, child);
  }
  append(...nodes: (FakeNode | string)[]): void {
    for (const n of nodes) appendTo(this, typeof n === "string" ? new FakeText(n) : n);
  }
  replaceChildren(...nodes: (FakeNode | string)[]): void {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.append(...nodes);
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  click(): void {
    if (this.disabled) return;
    for (const fn of this.handlers.get("click") ?? []) fn({});
  }
}

export class FakeFragment extends FakeNode {
  constructor() {
    super("#fragment");
  }
  get textContent(): string {
    return this.children.map((c) => (c instanceof FakeText ? c.data : c instanceof FakeElement || c instanceof FakeFragment ? c.textContent : "")).join("");
  }
  appendChild<T extends FakeNode>(child: T): T {
    return appendTo(this, child);
  }
}

function appendTo<T extends FakeNode>(parent: FakeNode, child: T): T {
  if (child instanceof FakeFragment) {
    for (const c of [...child.children]) appendTo(parent, c);
    child.children = [];
    return child;
  }
  child.parent?.children.splice(child.parent.children.indexOf(child), 1);
  child.parent = parent;
  parent.children.push(child);
  return child;
}

export class FakeDocument {
  readonly head = new FakeElement("head");
  createElement(tag: string): FakeElement {
    return new FakeElement(tag.toLowerCase());
  }
  /** Elements of another namespace (SVG) behave like any other fake element here. */
  createElementNS(_namespace: string, tag: string): FakeElement {
    return new FakeElement(tag);
  }
  createTextNode(data: string): FakeText {
    return new FakeText(data);
  }
  createDocumentFragment(): FakeFragment {
    return new FakeFragment();
  }
}

/** The fake document typed as the real one, for the render functions. */
export const fakeDoc = (): Document => new FakeDocument() as unknown as Document;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Serialises a node with every text and attribute value escaped. */
export function html(node: unknown): string {
  const n = node as FakeNode;
  if (n instanceof FakeText) return esc(n.data);
  const inner = n.children.map(html).join("");
  if (n instanceof FakeFragment) return inner;
  const e = n as FakeElement;
  const attrs = [
    e.className ? ` class="${esc(e.className)}"` : "",
    ...Object.entries(e.dataset).map(([k, v]) => ` data-${k}="${esc(v)}"`),
    ...[...e.attributes].map(([k, v]) => ` ${k}="${esc(v)}"`),
  ].join("");
  return VOID.has(e.tagName) ? `<${e.tagName}${attrs}>` : `<${e.tagName}${attrs}>${inner}</${e.tagName}>`;
}

/** All elements below `node` (depth first) that satisfy `pred`. */
export function findAll(node: unknown, pred: (e: FakeElement) => boolean): FakeElement[] {
  const out: FakeElement[] = [];
  const walk = (n: FakeNode) => {
    if (n instanceof FakeElement && pred(n)) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(node as FakeNode);
  return out;
}

export const textOf = (node: unknown): string => (node instanceof FakeText ? node.data : (node as FakeElement | FakeFragment).textContent);
