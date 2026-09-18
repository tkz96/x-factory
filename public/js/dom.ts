// public/js/dom.ts — Typed DOM construction, clearing, and diff rendering helpers.

export type Child = Node | string | number | null | undefined | false;

export interface ElementProps {
  id?: string | undefined;
  className?: string | undefined;
  textContent?: string | undefined;
  hidden?: boolean | undefined;
  disabled?: boolean | undefined;
  type?: string | undefined;
  value?: string | undefined;
  placeholder?: string | undefined;
  title?: string | undefined;
  href?: string | undefined;
  target?: string | undefined;
  rel?: string | undefined;
  style?: Record<string, string> | undefined;
  dataset?: Record<string, string | undefined> | undefined;
  attrs?: Record<string, string | number | boolean | undefined> | undefined;
  onClick?: ((e: MouseEvent) => void) | undefined;
  onChange?: ((e: Event) => void) | undefined;
  onInput?: ((e: Event) => void) | undefined;
}

function applyStylesAndData(element: HTMLElement, props: ElementProps): void {
  if (props.style) {
    for (const [k, v] of Object.entries(props.style)) {
      element.style.setProperty(k, v);
    }
  }
  if (props.dataset) {
    for (const [k, v] of Object.entries(props.dataset)) {
      if (v !== undefined) element.dataset[k] = v;
    }
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v !== undefined && v !== false) element.setAttribute(k, String(v));
    }
  }
}

function applyFormAndLinkAttrs(
  element: HTMLElement,
  props: ElementProps,
): void {
  if ("disabled" in element && props.disabled !== undefined) {
    (
      element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement
    ).disabled = props.disabled;
  }
  if ("type" in element && props.type !== undefined) {
    (element as HTMLButtonElement | HTMLInputElement).type = props.type;
  }
  if ("value" in element && props.value !== undefined) {
    (
      element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    ).value = props.value;
  }
  if ("placeholder" in element && props.placeholder !== undefined) {
    (element as HTMLInputElement | HTMLTextAreaElement).placeholder =
      props.placeholder;
  }
  if ("href" in element && props.href !== undefined) {
    (element as HTMLAnchorElement).href = props.href;
  }
  if ("target" in element && props.target !== undefined) {
    (element as HTMLAnchorElement).target = props.target;
  }
  if ("rel" in element && props.rel !== undefined) {
    (element as HTMLAnchorElement).rel = props.rel;
  }
}

function applyElementProps(element: HTMLElement, props: ElementProps): void {
  if (props.id !== undefined) element.id = props.id;
  if (props.className !== undefined) element.className = props.className;
  if (props.textContent !== undefined) element.textContent = props.textContent;
  if (props.hidden !== undefined) element.hidden = props.hidden;
  if (props.title !== undefined) element.title = props.title;

  if (props.onClick)
    element.addEventListener("click", props.onClick as EventListener);
  if (props.onChange)
    element.addEventListener("change", props.onChange as EventListener);
  if (props.onInput)
    element.addEventListener("input", props.onInput as EventListener);

  applyStylesAndData(element, props);
  applyFormAndLinkAttrs(element, props);
}

function appendChildren(
  element: HTMLElement,
  children?: Child | Child[],
): void {
  if (children === undefined) return;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) {
      element.appendChild(child);
    } else {
      element.appendChild(document.createTextNode(String(child)));
    }
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElementProps | undefined,
  children?: Child | Child[],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props) applyElementProps(element, props);
  appendChildren(element, children);
  return element;
}

export function clearElement(element: Element | null): void {
  if (!element) return;
  element.replaceChildren();
}

export function renderDiffElements(diffText: string): HTMLElement[] {
  if (!diffText) return [];
  const lines = diffText.split("\n");
  return lines.map((line) => {
    let extraCls = "";
    if (line.startsWith("+") && !line.startsWith("+++")) {
      extraCls = " diff-add";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      extraCls = " diff-del";
    } else if (line.startsWith("@@")) {
      extraCls = " diff-hunk";
    }
    const span = document.createElement("span");
    span.className = `diff-line${extraCls}`;
    span.textContent = line;
    return span;
  });
}

export type IconName =
  | "layers"
  | "play"
  | "clock"
  | "folder"
  | "settings"
  | "book-open"
  | "plus"
  | "search"
  | "refresh-cw"
  | "arrow-left"
  | "x"
  | "check"
  | "sun"
  | "moon"
  | "external-link"
  | "alert-circle"
  | "info"
  | "lock"
  | "shield-check"
  | "check-circle-2"
  | "x-circle"
  | "loader-2"
  | "calendar"
  | "git-branch"
  | "azure"
  | "github"
  | "gitlab"
  | "jira"
  | "bitbucket";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

export function renderIcon(
  name: IconName,
  size: IconSize = "md",
  extraClass = "",
): string {
  const cls = `icon icon-${size}${extraClass ? ` ${extraClass}` : ""}`;
  return `<svg class="${cls}" aria-hidden="true"><use href="/assets/icons/sprite.svg#icon-${name}"></use></svg>`;
}

export function createIconSvg(
  name: IconName,
  size: IconSize = "md",
  extraClass = "",
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute(
    "class",
    `icon icon-${size}${extraClass ? ` ${extraClass}` : ""}`,
  );
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `/assets/icons/sprite.svg#icon-${name}`);
  svg.appendChild(use);
  return svg;
}
