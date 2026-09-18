// test/dom-security.test.ts — Unit tests and DOM security assertions for typed DOM helpers (XF-018).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  clearElement,
  createIconSvg,
  el,
  renderDiffElements,
  renderIcon,
} from "../public/js/dom.js";

// Minimal DOM mock for Bun testing environment
class MockNode {
  nodeType = 1;
  childNodes: MockNode[] = [];
  parentNode: MockNode | null = null;

  appendChild(child: MockNode): MockNode {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  replaceChildren(...nodes: MockNode[]): void {
    this.childNodes = [...nodes];
  }
}

class MockTextNode extends MockNode {
  override nodeType = 3;
  textContent: string;

  constructor(text: string) {
    super();
    this.textContent = text;
  }
}

class MockElement extends MockNode {
  tagName: string;
  id = "";
  className = "";
  textContent = "";
  title = "";
  hidden = false;
  disabled = false;
  type = "";
  value = "";
  placeholder = "";
  href = "";
  target = "";
  rel = "";
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  styleProperties: Record<string, string> = {};
  listeners: Record<string, EventListener[]> = {};

  style = {
    setProperty: (k: string, v: string) => {
      this.styleProperties[k] = v;
    },
  };

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(k: string, v: string): void {
    this.attributes[k] = v;
  }

  getAttribute(k: string): string | undefined {
    return this.attributes[k];
  }

  querySelector(selector: string): MockElement | null {
    const sel = selector.toUpperCase();
    for (const child of this.childNodes) {
      if (child instanceof MockElement && child.tagName === sel) {
        return child;
      }
    }
    return null;
  }

  addEventListener(event: string, listener: EventListener): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
  }
}

describe("Typed DOM Helpers & XSS Protection (public/js/dom.ts)", () => {
  const originalDocument = globalThis.document;
  const originalNode = (globalThis as unknown as { Node: unknown }).Node;

  beforeEach(() => {
    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => new MockElement(tag),
      createElementNS: (_ns: string, tag: string) => new MockElement(tag),
      createTextNode: (text: string) => new MockTextNode(text),
    };
  });

  afterEach(() => {
    (globalThis as unknown as { document: unknown }).document =
      originalDocument;
    (globalThis as unknown as { Node: unknown }).Node = originalNode;
  });

  it("creates elements with typed props and attributes", () => {
    let clicked = false;
    let changed = false;
    let inputted = false;

    const input = el("input", {
      type: "text",
      value: "hello",
      placeholder: "enter value",
      onInput: () => {
        inputted = true;
      },
      onChange: () => {
        changed = true;
      },
    });

    expect((input as unknown as MockElement).type).toBe("text");
    expect((input as unknown as MockElement).value).toBe("hello");
    expect((input as unknown as MockElement).placeholder).toBe("enter value");

    const link = el("a", {
      href: "https://example.com",
      target: "_blank",
      rel: "noopener",
      onClick: () => {
        clicked = true;
      },
    });

    expect((link as unknown as MockElement).href).toBe("https://example.com");
    expect((link as unknown as MockElement).target).toBe("_blank");
    expect((link as unknown as MockElement).rel).toBe("noopener");

    (link as unknown as MockElement).listeners.click?.[0]?.(
      new Event("click") as MouseEvent,
    );
    expect(clicked).toBe(true);

    (input as unknown as MockElement).listeners.input?.[0]?.(
      new Event("input"),
    );
    expect(inputted).toBe(true);

    (input as unknown as MockElement).listeners.change?.[0]?.(
      new Event("change"),
    );
    expect(changed).toBe(true);

    const btn = el("button", {
      id: "save-btn",
      className: "btn btn-primary",
      textContent: "Save Changes",
      disabled: true,
      title: "Save Button",
      style: { display: "block" },
      dataset: { testid: "submit-action" },
      attrs: { "aria-label": "Save Item" },
    });

    expect(btn.id).toBe("save-btn");
    expect(btn.className).toBe("btn btn-primary");
    expect(btn.textContent).toBe("Save Changes");
    expect((btn as unknown as MockElement).disabled).toBe(true);
    expect(btn.title).toBe("Save Button");
    expect((btn as unknown as MockElement).styleProperties.display).toBe(
      "block",
    );
    expect(btn.dataset.testid).toBe("submit-action");
    expect((btn as unknown as MockElement).attributes["aria-label"]).toBe(
      "Save Item",
    );
  });

  it("safely handles XSS payloads in textContent and child nodes", () => {
    const maliciousInput =
      "<script>alert('pwned')</script><img src=x onerror=alert(1)>";
    const div = el("div", { className: "ticket-title" }, [maliciousInput]);

    // Children are created via createTextNode, ensuring no HTML injection
    const mockDiv = div as unknown as MockElement;
    expect(mockDiv.childNodes.length).toBe(1);
    const child = mockDiv.childNodes[0] as MockTextNode;
    expect(child.nodeType).toBe(3); // Text Node
    expect(child.textContent).toBe(maliciousInput);
  });

  it("clearElement safely empties element children via replaceChildren", () => {
    const container = el("div", {}, [
      el("span", { textContent: "Child 1" }),
      el("span", { textContent: "Child 2" }),
    ]);

    const mockContainer = container as unknown as MockElement;
    expect(mockContainer.childNodes.length).toBe(2);

    clearElement(container as unknown as Element);
    expect(mockContainer.childNodes.length).toBe(0);

    // Calling with null does not throw
    clearElement(null);
  });

  it("renderDiffElements maps diff lines to typed safe elements without innerHTML", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
-const oldVal = 1;
+const newVal = 2;
 const unchanged = 3;`;

    const elements = renderDiffElements(diff);
    expect(elements.length).toBe(6);

    // Hunk header
    expect(elements[2]?.className).toBe("diff-line diff-hunk");
    expect(elements[2]?.textContent).toBe("@@ -1,3 +1,4 @@");

    // Deletion
    expect(elements[3]?.className).toBe("diff-line diff-del");
    expect(elements[3]?.textContent).toBe("-const oldVal = 1;");

    // Addition
    expect(elements[4]?.className).toBe("diff-line diff-add");
    expect(elements[4]?.textContent).toBe("+const newVal = 2;");

    // Empty diff returns empty array
    expect(renderDiffElements("")).toEqual([]);
  });

  it("creates accessible SVG icons referencing the centralized sprite sheet", () => {
    const svg = createIconSvg("calendar", "xl", "custom-class");
    expect((svg as unknown as MockElement).getAttribute("class")).toBe(
      "icon icon-xl custom-class",
    );
    expect((svg as unknown as MockElement).getAttribute("aria-hidden")).toBe(
      "true",
    );
    const use = (svg as unknown as MockElement).querySelector("use");
    expect(use).toBeDefined();
    expect(use?.getAttribute("href")).toBe(
      "/assets/icons/sprite.svg#icon-calendar",
    );

    const html = renderIcon("search", "sm");
    expect(html).toContain('class="icon icon-sm"');
    expect(html).toContain('href="/assets/icons/sprite.svg#icon-search"');
  });
});
