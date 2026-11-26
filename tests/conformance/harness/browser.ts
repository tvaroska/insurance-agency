// Self-contained headless DOM + cookie-jar fetch runtime for executing the
// served React portal bundles in black-box conformance tests without Chrome or
// external DOM packages.

import type { Service } from "./service";

interface ListenerEntry {
  type: string;
  fn: (event: DomEvent) => void;
  capture: boolean;
  once: boolean;
}

export class DomEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  defaultPrevented = false;
  cancelBubble = false;
  immediatePropagationStopped = false;
  eventPhase = 0;
  target: DomNode | DomWindow | null = null;
  currentTarget: DomNode | DomWindow | null = null;
  readonly isTrusted = true;
  readonly timeStamp = Date.now();
  readonly detail: unknown;

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean; detail?: unknown } = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.detail = init.detail;
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.cancelBubble = true;
  }

  stopImmediatePropagation(): void {
    this.cancelBubble = true;
    this.immediatePropagationStopped = true;
  }
}

export class DomEventTarget {
  private readonly _listeners: ListenerEntry[] = [];

  addEventListener(
    type: string,
    listener: ((ev: any) => void) | { handleEvent(ev: any): void } | null,
    options?: boolean | { capture?: boolean; once?: boolean },
  ): void {
    if (!listener) return;
    const fn = typeof listener === "function" ? listener : (ev: DomEvent) => listener.handleEvent(ev);
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const once = typeof options === "object" && options !== null ? Boolean(options.once) : false;
    if (this._listeners.some((l) => l.type === type && l.fn === fn && l.capture === capture)) return;
    this._listeners.push({ type, fn, capture, once });
  }

  removeEventListener(
    type: string,
    listener: ((ev: any) => void) | { handleEvent(ev: any): void } | null,
    options?: boolean | { capture?: boolean },
  ): void {
    if (!listener) return;
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const idx = this._listeners.findIndex(
      (l) => l.type === type && l.fn === listener && l.capture === capture,
    );
    if (idx >= 0) this._listeners.splice(idx, 1);
  }

  _invokeListeners(event: DomEvent, capturePhase: boolean): void {
    const snapshot = this._listeners.filter((l) => l.type === event.type && l.capture === capturePhase);
    for (const entry of snapshot) {
      if (event.immediatePropagationStopped) break;
      if (entry.once) {
        const i = this._listeners.indexOf(entry);
        if (i >= 0) this._listeners.splice(i, 1);
      }
      entry.fn.call(this, event);
    }
  }
}

export class DomNode extends DomEventTarget {
  static readonly ELEMENT_NODE = 1;
  static readonly TEXT_NODE = 3;
  static readonly COMMENT_NODE = 8;
  static readonly DOCUMENT_NODE = 9;
  static readonly DOCUMENT_FRAGMENT_NODE = 11;

  readonly nodeType: number;
  readonly nodeName: string;
  parentNode: DomNode | null = null;
  readonly childNodes: DomNode[] = [];
  ownerDocument: DomDocument | null;
  _nodeValue: string | null = null;

  constructor(nodeType: number, nodeName: string, ownerDocument: DomDocument | null) {
    super();
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

  get parentElement(): DomElement | null {
    return this.parentNode instanceof DomElement ? this.parentNode : null;
  }

  get firstChild(): DomNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): DomNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get previousSibling(): DomNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i > 0 ? this.parentNode.childNodes[i - 1] : null;
  }

  get nextSibling(): DomNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 && i < this.parentNode.childNodes.length - 1 ? this.parentNode.childNodes[i + 1] : null;
  }

  get isConnected(): boolean {
    let cur: DomNode | null = this;
    while (cur) {
      if (cur.nodeType === DomNode.DOCUMENT_NODE) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  get nodeValue(): string | null {
    return this._nodeValue;
  }

  set nodeValue(val: string | null) {
    this._nodeValue = val === null ? "" : String(val);
  }

  get textContent(): string {
    if (this.nodeType === DomNode.TEXT_NODE || this.nodeType === DomNode.COMMENT_NODE) {
      return this._nodeValue ?? "";
    }
    let out = "";
    for (const child of this.childNodes) {
      if (child.nodeType !== DomNode.COMMENT_NODE) out += child.textContent;
    }
    return out;
  }

  set textContent(val: string) {
    if (this.nodeType === DomNode.TEXT_NODE || this.nodeType === DomNode.COMMENT_NODE) {
      this._nodeValue = val == null ? "" : String(val);
      return;
    }
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes.length = 0;
    const text = val == null ? "" : String(val);
    if (text.length > 0 && this.ownerDocument) {
      this.appendChild(this.ownerDocument.createTextNode(text));
    }
  }

  appendChild<T extends DomNode>(child: T): T {
    return this.insertBefore(child, null);
  }

  insertBefore<T extends DomNode>(child: T, ref: DomNode | null): T {
    if (child.nodeType === DomNode.DOCUMENT_FRAGMENT_NODE) {
      const moved = [...child.childNodes];
      for (const node of moved) this.insertBefore(node, ref);
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    if (ref === null || ref === undefined) {
      this.childNodes.push(child);
    } else {
      const idx = this.childNodes.indexOf(ref);
      if (idx < 0) this.childNodes.push(child);
      else this.childNodes.splice(idx, 0, child);
    }
    child.parentNode = this;
    return child;
  }

  removeChild<T extends DomNode>(child: T): T {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  replaceChild<T extends DomNode>(next: DomNode, old: T): T {
    this.insertBefore(next, old);
    return this.removeChild(old);
  }

  contains(other: DomNode | null): boolean {
    let cur: DomNode | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  dispatchEvent(event: DomEvent): boolean {
    const path: (DomNode | DomWindow)[] = [];
    let cur: DomNode | null = this;
    while (cur) {
      path.push(cur);
      cur = cur.parentNode;
    }
    const win = this.ownerDocument?.defaultView ?? (this instanceof DomDocument ? this.defaultView : null);
    if (win) path.push(win);

    event.target = this;
    const prevEvent = win ? win.event : undefined;
    if (win) win.event = event;

    try {
      // Capture phase (window -> parent of target)
      event.eventPhase = 1;
      for (let i = path.length - 1; i >= 1; i--) {
        if (event.cancelBubble) break;
        const node = path[i];
        event.currentTarget = node;
        node._invokeListeners(event, true);
      }

      // Target phase
      if (!event.cancelBubble) {
        event.eventPhase = 2;
        event.currentTarget = this;
        this._invokeListeners(event, true);
        if (!event.immediatePropagationStopped) {
          this._invokeListeners(event, false);
        }
      }

      // Bubble phase (parent of target -> window)
      if (event.bubbles && !event.cancelBubble) {
        event.eventPhase = 3;
        for (let i = 1; i < path.length; i++) {
          if (event.cancelBubble) break;
          const node = path[i];
          event.currentTarget = node;
          node._invokeListeners(event, false);
        }
      }
    } finally {
      event.currentTarget = null;
      event.eventPhase = 0;
      if (win) win.event = prevEvent;
    }

    return !event.defaultPrevented;
  }
}

export class DomText extends DomNode {
  constructor(text: string, ownerDocument: DomDocument) {
    super(DomNode.TEXT_NODE, "#text", ownerDocument);
    this._nodeValue = String(text);
  }

  get data(): string {
    return this._nodeValue ?? "";
  }

  set data(v: string) {
    this._nodeValue = String(v);
  }
}

export class DomComment extends DomNode {
  constructor(text: string, ownerDocument: DomDocument) {
    super(DomNode.COMMENT_NODE, "#comment", ownerDocument);
    this._nodeValue = String(text);
  }
}

export class DomDocumentFragment extends DomNode {
  constructor(ownerDocument: DomDocument) {
    super(DomNode.DOCUMENT_FRAGMENT_NODE, "#document-fragment", ownerDocument);
  }
}

class DomStyle {
  private readonly props = new Map<string, string>();
  cssText = "";

  setProperty(name: string, value: string): void {
    this.props.set(name, String(value));
  }

  removeProperty(name: string): void {
    this.props.delete(name);
  }

  getPropertyValue(name: string): string {
    return this.props.get(name) ?? "";
  }
}

function createStyleProxy(): Record<string, any> {
  const target = new DomStyle();
  return new Proxy(target as Record<string, any>, {
    get(obj, prop) {
      if (prop in obj) {
        const v = (obj as any)[prop];
        return typeof v === "function" ? v.bind(obj) : v;
      }
      return obj.getPropertyValue(String(prop));
    },
    set(obj, prop, val) {
      if (prop === "cssText") {
        obj.cssText = String(val ?? "");
        return true;
      }
      obj.setProperty(String(prop), val == null ? "" : String(val));
      return true;
    },
  });
}

export class DomElement extends DomNode {
  readonly tagName: string;
  readonly localName: string;
  readonly namespaceURI: string;
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, any> = createStyleProxy();

  constructor(tag: string, ownerDocument: DomDocument, namespaceURI = "http://www.w3.org/1999/xhtml") {
    const upper = namespaceURI === "http://www.w3.org/1999/xhtml" ? tag.toUpperCase() : tag;
    super(DomNode.ELEMENT_NODE, upper, ownerDocument);
    this.tagName = upper;
    this.localName = tag.toLowerCase();
    this.namespaceURI = namespaceURI;
  }

  get children(): DomElement[] {
    return this.childNodes.filter((n): n is DomElement => n instanceof DomElement);
  }

  get firstElementChild(): DomElement | null {
    return this.children[0] ?? null;
  }

  get id(): string {
    return this.attributes.get("id") ?? "";
  }
  set id(val: string) {
    this.setAttribute("id", val);
  }

  get className(): string {
    return this.attributes.get("class") ?? "";
  }
  set className(val: string) {
    this.setAttribute("class", val ?? "");
  }

  get classList() {
    const read = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c: string) => read().includes(c),
      add: (...cs: string[]) => {
        const set = new Set(read());
        for (const c of cs) set.add(c);
        this.className = [...set].join(" ");
      },
      remove: (...cs: string[]) => {
        const set = new Set(read());
        for (const c of cs) set.delete(c);
        this.className = [...set].join(" ");
      },
    };
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }
  set disabled(val: boolean) {
    if (val) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }

  get type(): string {
    if (this.attributes.has("type")) return this.attributes.get("type")!;
    if (this.tagName === "BUTTON") return "submit";
    if (this.tagName === "INPUT") return "text";
    return "";
  }
  set type(val: string) {
    this.setAttribute("type", val);
  }

  oninput: ((ev: any) => void) | null = null;
  onchange: ((ev: any) => void) | null = null;
  onclick: ((ev: any) => void) | null = null;
  onsubmit: ((ev: any) => void) | null = null;
  onfocus: ((ev: any) => void) | null = null;
  onblur: ((ev: any) => void) | null = null;
  onkeydown: ((ev: any) => void) | null = null;
  onkeyup: ((ev: any) => void) | null = null;
  onmousedown: ((ev: any) => void) | null = null;
  onmouseup: ((ev: any) => void) | null = null;

  get name(): string {
    return this.attributes.get("name") ?? "";
  }
  set name(val: string) {
    this.setAttribute("name", val);
  }

  get placeholder(): string {
    return this.attributes.get("placeholder") ?? "";
  }
  set placeholder(val: string) {
    this.setAttribute("placeholder", val);
  }

  get maxLength(): number {
    const v = this.attributes.get("maxlength");
    return v ? Number(v) : -1;
  }
  set maxLength(val: number) {
    this.setAttribute("maxlength", String(val));
  }

  get innerHTML(): string {
    return this.textContent;
  }
  set innerHTML(val: string) {
    this.textContent = val;
  }

  setAttribute(name: string, value: string): void {
    const key = name.toLowerCase();
    this.attributes.set(key, String(value));
  }

  setAttributeNS(_ns: string | null, name: string, value: string): void {
    this.setAttribute(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
    this.dispatchEvent(new DomEvent("focus", { bubbles: false }));
    this.dispatchEvent(new DomEvent("focusin", { bubbles: true }));
  }

  blur(): void {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
    this.dispatchEvent(new DomEvent("blur", { bubbles: false }));
    this.dispatchEvent(new DomEvent("focusout", { bubbles: true }));
  }

  matches(selector: string): boolean {
    const s = selector.trim();
    if (!s) return false;
    if (s.startsWith("#")) return this.id === s.slice(1);
    if (s.startsWith(".")) return this.classList.contains(s.slice(1));
    const attrMatch = /^([a-z0-9_-]*)\[([a-z0-9_-]+)(?:="([^"]*)")?\]$/i.exec(s);
    if (attrMatch) {
      const [, tag, attr, expected] = attrMatch;
      if (tag && this.localName !== tag.toLowerCase()) return false;
      if (!this.hasAttribute(attr)) return false;
      return expected === undefined ? true : this.getAttribute(attr) === expected;
    }
    const dotParts = s.split(".");
    if (dotParts.length > 1) {
      if (dotParts[0] && this.localName !== dotParts[0].toLowerCase()) return false;
      return dotParts.slice(1).every((cls) => this.classList.contains(cls));
    }
    return this.localName === s.toLowerCase();
  }

  closest(selector: string): DomElement | null {
    let cur: DomElement | null = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelectorAll(selector: string): DomElement[] {
    const parts = selector
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const results: DomElement[] = [];
    const walk = (node: DomNode) => {
      for (const child of node.childNodes) {
        if (child instanceof DomElement) {
          if (parts.some((p) => child.matches(p))) results.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector: string): DomElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getElementsByTagName(tag: string): DomElement[] {
    const target = tag.toLowerCase();
    const out: DomElement[] = [];
    const walk = (node: DomNode) => {
      for (const child of node.childNodes) {
        if (child instanceof DomElement) {
          if (target === "*" || child.localName === target) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }

  click(): void {
    if (this.disabled) return;
    if (this instanceof DomInputElement && this.type === "checkbox") {
      const nextChecked = !this.checked;
      const desc = Object.getOwnPropertyDescriptor(DomInputElement.prototype, "checked");
      desc?.set?.call(this, nextChecked);
      this.dispatchEvent(new DomEvent("click", { bubbles: true, cancelable: true }));
      this.dispatchEvent(new DomEvent("input", { bubbles: true }));
      this.dispatchEvent(new DomEvent("change", { bubbles: true }));
      return;
    }
    const clickEv = new DomEvent("click", { bubbles: true, cancelable: true });
    this.dispatchEvent(clickEv);
    if (!clickEv.defaultPrevented && this.tagName === "BUTTON" && this.type === "submit") {
      const form = this.closest("form");
      if (form) form.dispatchEvent(new DomEvent("submit", { bubbles: true, cancelable: true }));
    }
  }
}

export class DomInputElement extends DomElement {
  _value = "";
  _checked = false;
  defaultValue = "";
  defaultChecked = false;
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;

  constructor(ownerDocument: DomDocument) {
    super("input", ownerDocument);
  }

  get value(): string {
    return this._value;
  }
  set value(v: string) {
    this._value = v == null ? "" : String(v);
  }

  get checked(): boolean {
    return this._checked;
  }
  set checked(v: boolean) {
    this._checked = Boolean(v);
  }

  override setAttribute(name: string, value: string): void {
    super.setAttribute(name, value);
    const k = name.toLowerCase();
    if (k === "value") this._value = String(value);
    if (k === "checked") this._checked = true;
  }

  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

export class DomTextAreaElement extends DomElement {
  _value = "";
  defaultValue = "";

  constructor(ownerDocument: DomDocument) {
    super("textarea", ownerDocument);
  }

  get value(): string {
    return this._value;
  }
  set value(v: string) {
    this._value = v == null ? "" : String(v);
  }
}

export class DomOptionElement extends DomElement {
  _selected = false;
  defaultSelected = false;

  constructor(ownerDocument: DomDocument) {
    super("option", ownerDocument);
  }

  get value(): string {
    return this.attributes.has("value") ? (this.attributes.get("value") ?? "") : this.textContent;
  }
  set value(v: string) {
    this.setAttribute("value", v == null ? "" : String(v));
  }

  get selected(): boolean {
    return this._selected;
  }
  set selected(v: boolean) {
    this._selected = Boolean(v);
  }
}

export class DomSelectElement extends DomElement {
  _value = "";
  multiple = false;

  constructor(ownerDocument: DomDocument) {
    super("select", ownerDocument);
  }

  get options(): DomOptionElement[] {
    return this.querySelectorAll("option").filter((el): el is DomOptionElement => el instanceof DomOptionElement);
  }

  get value(): string {
    if (this._value !== "") return this._value;
    const selected = this.options.find((o) => o.selected);
    return selected ? selected.value : (this.options[0]?.value ?? "");
  }
  set value(v: string) {
    const next = v == null ? "" : String(v);
    this._value = next;
    for (const opt of this.options) opt.selected = opt.value === next;
  }

  get selectedIndex(): number {
    return this.options.findIndex((o) => o.value === this.value);
  }
  set selectedIndex(idx: number) {
    const opt = this.options[idx];
    if (opt) this.value = opt.value;
  }
}

export class DomButtonElement extends DomElement {
  constructor(ownerDocument: DomDocument) {
    super("button", ownerDocument);
  }
}

export class DomFormElement extends DomElement {
  constructor(ownerDocument: DomDocument) {
    super("form", ownerDocument);
  }
}

export class DomDocument extends DomNode {
  defaultView: DomWindow | null = null;
  readonly documentElement: DomElement;
  readonly head: DomElement;
  readonly body: DomElement;
  activeElement: DomElement | null = null;
  readyState = "complete";
  oninput: ((ev: any) => void) | null = null;
  onchange: ((ev: any) => void) | null = null;
  onclick: ((ev: any) => void) | null = null;
  onsubmit: ((ev: any) => void) | null = null;
  onfocus: ((ev: any) => void) | null = null;
  onblur: ((ev: any) => void) | null = null;
  onkeydown: ((ev: any) => void) | null = null;
  onkeyup: ((ev: any) => void) | null = null;

  constructor() {
    super(DomNode.DOCUMENT_NODE, "#document", null);
    this.documentElement = new DomElement("html", this);
    this.head = new DomElement("head", this);
    this.body = new DomElement("body", this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }

  createElement(tag: string): DomElement {
    switch (tag.toLowerCase()) {
      case "input":
        return new DomInputElement(this);
      case "select":
        return new DomSelectElement(this);
      case "option":
        return new DomOptionElement(this);
      case "textarea":
        return new DomTextAreaElement(this);
      case "button":
        return new DomButtonElement(this);
      case "form":
        return new DomFormElement(this);
      default:
        return new DomElement(tag, this);
    }
  }

  createElementNS(ns: string, tag: string): DomElement {
    return new DomElement(tag, this, ns);
  }

  createTextNode(text: string): DomText {
    return new DomText(text, this);
  }

  createComment(text: string): DomComment {
    return new DomComment(text, this);
  }

  createDocumentFragment(): DomDocumentFragment {
    return new DomDocumentFragment(this);
  }

  getElementById(id: string): DomElement | null {
    return this.documentElement.querySelector(`#${id}`);
  }

  querySelector(selector: string): DomElement | null {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): DomElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  getElementsByTagName(tag: string): DomElement[] {
    return this.documentElement.getElementsByTagName(tag);
  }
}

class DomMutationObserver {
  constructor(private readonly _callback: (...args: any[]) => void) {}
  observe(): void {}
  disconnect(): void {}
  takeRecords(): any[] {
    return [];
  }
}

class DomWindow extends DomEventTarget {
  readonly document: DomDocument;
  readonly window: DomWindow;
  readonly self: DomWindow;
  readonly navigator = { userAgent: "EvergreenHeadlessConformance/1.0" };
  readonly location: { href: string; origin: string; pathname: string };
  event: DomEvent | undefined = undefined;
  readonly Node = DomNode;
  readonly Element = DomElement;
  readonly HTMLElement = DomElement;
  readonly HTMLInputElement = DomInputElement;
  readonly HTMLSelectElement = DomSelectElement;
  readonly HTMLTextAreaElement = DomTextAreaElement;
  readonly HTMLOptionElement = DomOptionElement;
  readonly HTMLButtonElement = DomButtonElement;
  readonly HTMLFormElement = DomFormElement;
  readonly HTMLLinkElement = DomElement;
  readonly HTMLIFrameElement = DomElement;
  readonly SVGElement = DomElement;
  readonly MutationObserver = DomMutationObserver;
  readonly Event = DomEvent;
  readonly CustomEvent = DomEvent;
  readonly MouseEvent = DomEvent;
  readonly InputEvent = DomEvent;
  readonly FocusEvent = DomEvent;
  readonly KeyboardEvent = DomEvent;

  constructor(document: DomDocument, baseUrl: string) {
    super();
    this.document = document;
    this.window = this;
    this.self = this;
    document.defaultView = this;
    const u = new URL(baseUrl);
    this.location = { href: u.toString(), origin: u.origin, pathname: u.pathname };
  }

  dispatchEvent(event: DomEvent): boolean {
    event.target = this;
    event.currentTarget = this;
    this._invokeListeners(event, false);
    return !event.defaultPrevented;
  }
}

export interface RecordedPageRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  requestBody: unknown;
  status: number;
  responseBody: unknown;
}

export interface PortalPage {
  readonly document: DomDocument;
  readonly root: DomElement;
  readonly cookies: Map<string, string>;
  readonly requests: RecordedPageRequest[];
  text(): string;
  inputByLabel(label: string): DomInputElement;
  selectByLabel(label: string): DomSelectElement;
  buttonByText(label: string): DomButtonElement;
  type(input: DomInputElement | DomTextAreaElement, value: string): Promise<void>;
  select(select: DomSelectElement, value: string): Promise<void>;
  click(element: DomElement): Promise<void>;
  waitFor(predicate: () => boolean, timeoutMs?: number): Promise<void>;
  flush(): Promise<void>;
  close(): void;
}

const flushMicrotasks = async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

/**
 * Loads `GET /` from a running portal service, stores its `Set-Cookie`
 * bootstrap cookie in a cookie jar, fetches the served `<script src="...">`
 * React bundle over HTTP, and mounts the app in an isolated headless DOM.
 */
export async function openPortalPage(svc: Service): Promise<PortalPage> {
  const cookies = new Map<string, string>();
  const requests: RecordedPageRequest[] = [];

  const storeSetCookies = (headers: Headers) => {
    for (const raw of headers.getSetCookie()) {
      const pair = raw.split(";")[0]?.trim();
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  };

  const cookieHeader = () =>
    cookies.size > 0 ? [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") : undefined;

  const pageFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const hdrs: Record<string, string> = {};
    if (init.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => {
        hdrs[k] = v;
      });
    }
    const existingCookie = cookieHeader();
    if (existingCookie && !Object.keys(hdrs).some((k) => k.toLowerCase() === "cookie")) {
      hdrs.Cookie = existingCookie;
    }

    const url = new URL(rawUrl, svc.baseUrl);
    const pathWithQuery = `${url.pathname}${url.search}`;
    const res = await svc.http.request(method, pathWithQuery, {
      headers: hdrs,
      body: init.body as unknown,
    });
    storeSetCookies(res.headers);

    let parsedReqBody: unknown = init.body;
    if (typeof init.body === "string") {
      try {
        parsedReqBody = JSON.parse(init.body);
      } catch {
        parsedReqBody = init.body;
      }
    }
    requests.push({
      method,
      path: pathWithQuery,
      headers: hdrs,
      requestBody: parsedReqBody,
      status: res.status,
      responseBody: res.body,
    });

    const responseHeaders = new Headers();
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() !== "set-cookie") responseHeaders.append(k, v);
    });
    return new Response(new Uint8Array(res.bytes), { status: res.status, headers: responseHeaders });
  };

  const pageRes = await svc.http.get("/");
  if (pageRes.status !== 200) {
    throw new Error(`GET / returned ${pageRes.status}: ${pageRes.text.slice(0, 200)}`);
  }
  storeSetCookies(pageRes.headers);
  requests.push({
    method: "GET",
    path: "/",
    headers: {},
    requestBody: undefined,
    status: pageRes.status,
    responseBody: pageRes.text,
  });

  const scriptPath = /<script[^>]+src="([^"]+)"/.exec(pageRes.text)?.[1];
  if (!scriptPath) throw new Error("Portal HTML shell has no <script src> entry");
  const bundleRes = await svc.http.get(scriptPath);
  if (bundleRes.status !== 200) {
    throw new Error(`GET ${scriptPath} returned ${bundleRes.status}`);
  }

  const doc = new DomDocument();
  const win = new DomWindow(doc, svc.baseUrl);
  const root = doc.createElement("div");
  root.id = "root";
  doc.body.appendChild(root);

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const raf = (cb: (ts: number) => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      cb(performance.now());
    }, 0);
    timers.add(id);
    return id;
  };
  const caf = (id: ReturnType<typeof setTimeout>) => {
    timers.delete(id);
    clearTimeout(id);
  };

  // Mount the served Vite production bundle with isolated browser globals.
  const runner = new Function(
    "window",
    "document",
    "self",
    "navigator",
    "location",
    "fetch",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLTextAreaElement",
    "HTMLOptionElement",
    "HTMLButtonElement",
    "HTMLFormElement",
    "HTMLLinkElement",
    "HTMLIFrameElement",
    "SVGElement",
    "MutationObserver",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "InputEvent",
    "FocusEvent",
    "KeyboardEvent",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
    bundleRes.text,
  );

  // React 19 checks globalThis.document / globalThis.HTMLIFrameElement during
  // initialization in some branches; bind cleanly during synchronous mount and restore.
  const prevGlobalDoc = (globalThis as any).document;
  const prevGlobalWin = (globalThis as any).window;
  (globalThis as any).document = doc;
  (globalThis as any).window = win;
  try {
    runner(
      win,
      doc,
      win,
      win.navigator,
      win.location,
      pageFetch,
      DomNode,
      DomElement,
      DomElement,
      DomInputElement,
      DomSelectElement,
      DomTextAreaElement,
      DomOptionElement,
      DomButtonElement,
      DomFormElement,
      DomElement,
      DomElement,
      DomElement,
      DomMutationObserver,
      DomEvent,
      DomEvent,
      DomEvent,
      DomEvent,
      DomEvent,
      DomEvent,
      raf,
      caf,
      () => ({ getPropertyValue: () => "" }),
    );
    await flushMicrotasks();
    await flushMicrotasks();
  } finally {
    if (prevGlobalDoc === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = prevGlobalDoc;
    if (prevGlobalWin === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = prevGlobalWin;
  }

  const withGlobals = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    const pd = (globalThis as any).document;
    const pw = (globalThis as any).window;
    (globalThis as any).document = doc;
    (globalThis as any).window = win;
    try {
      return await fn();
    } finally {
      if (pd === undefined) delete (globalThis as any).document;
      else (globalThis as any).document = pd;
      if (pw === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = pw;
    }
  };

  const findControlByLabel = (label: string, tag: "input" | "select"): DomElement => {
    const groups = root.querySelectorAll(".form-group");
    for (const group of groups) {
      const lbl = group.querySelector("label");
      if (lbl && lbl.textContent.trim() === label) {
        const ctrl = group.querySelector(tag);
        if (ctrl) return ctrl;
      }
    }
    throw new Error(`No <${tag}> found for label '${label}'. Visible text: ${root.textContent.slice(0, 300)}`);
  };

  const page: PortalPage = {
    document: doc,
    root,
    cookies,
    requests,
    text: () => root.textContent,
    inputByLabel: (label) => findControlByLabel(label, "input") as DomInputElement,
    selectByLabel: (label) => findControlByLabel(label, "select") as DomSelectElement,
    buttonByText: (label) => {
      const btn = root
        .querySelectorAll("button")
        .find((b) => b.textContent.trim() === label);
      if (!btn) {
        const seen = root.querySelectorAll("button").map((b) => b.textContent.trim());
        throw new Error(`No button with text '${label}'. Found: ${JSON.stringify(seen)}`);
      }
      return btn as DomButtonElement;
    },
    type: async (input, value) => {
      await withGlobals(async () => {
        const proto =
          input instanceof DomTextAreaElement ? DomTextAreaElement.prototype : DomInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter?.call(input, value);
        input.dispatchEvent(new DomEvent("input", { bubbles: true }));
        input.dispatchEvent(new DomEvent("change", { bubbles: true }));
        await flushMicrotasks();
      });
    },
    select: async (sel, value) => {
      await withGlobals(async () => {
        const setter = Object.getOwnPropertyDescriptor(DomSelectElement.prototype, "value")?.set;
        setter?.call(sel, value);
        sel.dispatchEvent(new DomEvent("input", { bubbles: true }));
        sel.dispatchEvent(new DomEvent("change", { bubbles: true }));
        await flushMicrotasks();
      });
    },
    click: async (el) => {
      await withGlobals(async () => {
        el.click();
        await flushMicrotasks();
      });
    },
    waitFor: async (predicate, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const matched = await withGlobals(() => predicate());
        if (matched) return;
        await flushMicrotasks();
      }
      throw new Error(`Timed out waiting for portal DOM condition. Current text: ${root.textContent.slice(0, 400)}`);
    },
    flush: async () => {
      await withGlobals(async () => {
        await flushMicrotasks();
      });
    },
    close: () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };

  return page;
}
