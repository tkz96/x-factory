// public/js/views/template-helper.ts — Native WHATWG HTMLTemplateElement helper for static view shells.

export function createViewFromTemplate(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  const el = template.content.firstElementChild;
  if (!el || !(el instanceof HTMLElement)) {
    throw new Error(
      "Invalid template HTML: Root element must be an HTMLElement",
    );
  }
  return el;
}
