// test/ui-blocks.test.tsx — Behaviour of the control building blocks (#251,
// spec #241): keyboard, disabled, focus and labelling. The blocks are React
// Aria primitives styled with tokens, so the behaviour asserted here is the
// behaviour a real browser gives a real keyboard user.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { Badge } from "../src/frontend/components/ui/Badge.js";
import { Button } from "../src/frontend/components/ui/Button.js";
import { EmptyState } from "../src/frontend/components/ui/EmptyState.js";
import { IconButton } from "../src/frontend/components/ui/IconButton.js";
import {
  ListGroup,
  ListGroupRow,
  ListGroupValue,
} from "../src/frontend/components/ui/ListGroup.js";
import {
  ListRow,
  ListRowContent,
  PlaceholderRows,
} from "../src/frontend/components/ui/ListRow.js";
import { SegmentedControl } from "../src/frontend/components/ui/SegmentedControl.js";
import { SelectField } from "../src/frontend/components/ui/SelectField.js";
import { Spinner } from "../src/frontend/components/ui/Spinner.js";
import { SwitchControl } from "../src/frontend/components/ui/SwitchControl.js";
import {
  TextAreaField,
  TextField,
} from "../src/frontend/components/ui/TextField.js";

afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

afterEach(() => {
  cleanup();
});

function classesOf(element: Element | null): string {
  return element?.getAttribute("class") ?? "";
}

describe("Button — the button block", () => {
  it("shows its title as the hover tooltip (shortcut hints, #254)", () => {
    const { getByRole } = render(
      createElement(Button, { title: "Start Run (N)" }, "Start Run"),
    );
    expect(
      getByRole("button", { name: "Start Run" }).getAttribute("title"),
    ).toBe("Start Run (N)");
  });

  it("presses with the pointer and with the keyboard", () => {
    let presses = 0;
    const { getByRole } = render(
      createElement(
        Button,
        {
          onPress: () => {
            presses += 1;
          },
        },
        "Save",
      ),
    );
    const button = getByRole("button", { name: "Save" });

    fireEvent.click(button);
    expect(presses).toBe(1);

    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyUp(button, { key: "Enter" });
    expect(presses).toBe(2);

    fireEvent.keyDown(button, { key: " " });
    fireEvent.keyUp(button, { key: " " });
    expect(presses).toBe(3);
  });

  it("renders the variant, size and icon from the vocabulary", () => {
    const { getByRole } = render(
      createElement(
        Button,
        { variant: "primary", size: "lg", icon: "icon-plus" },
        "Launch",
      ),
    );
    const button = getByRole("button", { name: "Launch" });

    expect(classesOf(button)).toContain("ui-button--primary");
    expect(classesOf(button)).toContain("ui-button--lg");
    expect(button.querySelector("use")?.getAttribute("href")).toBe(
      "/assets/icons/sprite.svg#icon-plus",
    );
  });

  it("announces and refuses presses while disabled", () => {
    let presses = 0;
    const { getByRole } = render(
      createElement(
        Button,
        {
          isDisabled: true,
          onPress: () => {
            presses += 1;
          },
        },
        "Save",
      ),
    );
    const button = getByRole("button", { name: "Save" }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute("data-disabled")).toBe("true");
    fireEvent.click(button);
    expect(presses).toBe(0);
  });

  it("takes keyboard focus and marks the focus-ring state", () => {
    const { getByRole } = render(createElement(Button, {}, "Save"));
    const button = getByRole("button", { name: "Save" });

    // Keyboard focus, so the ring shows for a keyboard user and not for a
    // pointer user — the state the token-driven ring keys off.
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => {
      button.focus();
    });
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("data-focus-visible")).not.toBeNull();
  });
});

describe("IconButton — an icon-only control is always labelled", () => {
  it("exposes the accessible name and draws the sprite icon", () => {
    const { getByRole } = render(
      createElement(IconButton, { label: "Close", icon: "icon-x" }),
    );
    const button = getByRole("button", { name: "Close" });

    expect(classesOf(button)).toContain("ui-icon-button");
    expect(button.querySelector("use")?.getAttribute("href")).toBe(
      "/assets/icons/sprite.svg#icon-x",
    );
    expect(button.textContent).toBe("");
  });
});

describe("TextField and TextAreaField — the field blocks", () => {
  it("labels the input and accepts typing", () => {
    const values: string[] = [];
    const { getByLabelText } = render(
      createElement(TextField, {
        label: "Repository URL",
        onChange: (value: string) => values.push(value),
      }),
    );
    const input = getByLabelText("Repository URL") as HTMLInputElement;

    act(() => {
      input.focus();
      fireEvent.change(input, { target: { value: "https://example.com" } });
      fireEvent.keyUp(input);
    });

    expect(values).toContain("https://example.com");
  });

  it("wires the description to the input and renders the feedback slot", () => {
    const { getByLabelText, container } = render(
      createElement(TextField, {
        label: "Branch",
        description: "The branch the run works on.",
        inputId: "branch-input",
        feedback: createElement("span", { id: "branch-feedback" }, "Required."),
      }),
    );
    const input = getByLabelText("Branch");

    expect(input.id).toBe("branch-input");
    expect(container.querySelector("#branch-feedback")).not.toBeNull();
    expect(container.textContent).toContain("The branch the run works on.");
  });

  it("carries the disabled state onto the input", () => {
    const { getByLabelText } = render(
      createElement(TextField, { label: "Token", isDisabled: true }),
    );
    const input = getByLabelText("Token") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("renders a text area for longer input", () => {
    const { getByLabelText } = render(
      createElement(TextAreaField, { label: "Plan" }),
    );
    const area = getByLabelText("Plan");
    expect(area.tagName).toBe("TEXTAREA");
    expect(classesOf(area)).toContain("ui-textarea");
  });
});

describe("SelectField — the select block", () => {
  const OPTIONS = [
    { id: "github", label: "GitHub" },
    { id: "jira", label: "Jira" },
  ];

  it("opens a listbox, selects with the pointer, and shows the choice", () => {
    const chosen: string[] = [];
    const { getByRole } = render(
      createElement(SelectField, {
        label: "Tracker",
        options: OPTIONS,
        defaultSelectedKey: "github",
        onSelectionChange: (key: unknown) => chosen.push(String(key)),
      }),
    );

    const trigger = getByRole("button", { name: /Tracker/ });
    expect(trigger.textContent).toContain("GitHub");

    fireEvent.click(trigger);
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();

    fireEvent.click(getByRole("option", { name: "Jira" }));
    expect(chosen).toEqual(["jira"]);
    // The select is on the block: the keyboard reaches every option.
    expect(getByRole("option", { name: "GitHub" })).toBeTruthy();
  });

  it("refuses to open while disabled", () => {
    const { getByRole } = render(
      createElement(SelectField, {
        label: "Tracker",
        options: OPTIONS,
        isDisabled: true,
      }),
    );
    const trigger = getByRole("button", {
      name: /Tracker/,
    }) as HTMLButtonElement;

    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe("SegmentedControl — one control, mutually exclusive options", () => {
  const OPTIONS = [
    { id: "automatic", label: "Automatic" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];

  function Harness({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = useState("light");
    return createElement(SegmentedControl, {
      label: "Appearance",
      value,
      onChange: setValue,
      options: OPTIONS,
      isDisabled: disabled,
    });
  }

  it("is a named radiogroup whose selected segment is checked", () => {
    const { getByRole } = render(createElement(Harness));
    const group = getByRole("radiogroup", { name: "Appearance" });

    expect(classesOf(group)).toContain("ui-segmented");
    expect(group.getAttribute("aria-orientation")).toBe("horizontal");
    // The visible segment is the label of the native radio input, and React
    // Aria marks it selected — that is what the tokens style.
    const light = getByRole("radio", { name: "Light" }) as HTMLInputElement;
    expect(light.checked).toBe(true);
    expect(light.closest("label")?.getAttribute("data-selected")).toBe("true");
    expect(
      (getByRole("radio", { name: "Automatic" }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("below its collapse threshold the same options render as a select (#290)", () => {
    // The threshold the Runs filter uses: pretend the viewport is narrower.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const changed: string[] = [];
      const { getByRole, queryByRole } = render(
        createElement(SegmentedControl, {
          label: "Show",
          value: "running",
          onChange: (id: string) => changed.push(id),
          options: [
            { id: "running", label: "Running", count: 3 },
            { id: "done", label: "Done", count: 12 },
          ],
          collapseBelow: "(max-width: 400px)",
        }),
      );

      // No radiogroup: the control is the select block, with the counts in
      // the option labels so nothing the segments said is lost.
      expect(queryByRole("radiogroup")).toBeNull();
      const trigger = getByRole("button", {
        name: /Show/,
      }) as HTMLButtonElement;
      expect(classesOf(trigger)).toContain("ui-select-trigger");
      expect(trigger.textContent).toContain("Running (3)");

      // Choosing from the listbox reaches the same onChange with the id.
      fireEvent.click(trigger);
      fireEvent.click(getByRole("option", { name: "Done (12)" }));
      expect(changed).toEqual(["done"]);
    } finally {
      window.matchMedia = original;
    }
  });

  it("changes the choice with the pointer and with the arrow keys", () => {
    const { getByRole } = render(createElement(Harness));
    const dark = getByRole("radio", { name: "Dark" }) as HTMLInputElement;

    fireEvent.click(dark);
    expect(dark.checked).toBe(true);

    // A segmented control is one tab stop: the arrows move between segments,
    // and only the selected segment is in the tab order.
    fireEvent.keyDown(dark, { key: "ArrowLeft" });
    const light = getByRole("radio", { name: "Light" }) as HTMLInputElement;
    expect(light.checked).toBe(true);
    expect(light.getAttribute("tabindex")).toBe("0");
    expect(getByRole("radio", { name: "Dark" }).getAttribute("tabindex")).toBe(
      "-1",
    );
  });

  it("refuses interaction while disabled", () => {
    const { getByRole } = render(createElement(Harness, { disabled: true }));
    const group = getByRole("radiogroup", { name: "Appearance" });
    expect(group.getAttribute("data-disabled")).toBe("true");

    const dark = getByRole("radio", { name: "Dark" }) as HTMLInputElement;
    fireEvent.click(dark);
    expect(dark.checked).toBe(false);
  });
});

describe("SwitchControl — the switch block", () => {
  it("is a native switch the platform can toggle, and toggles on a press", () => {
    const changes: boolean[] = [];
    const { getByRole } = render(
      createElement(SwitchControl, {
        label: "Desktop banners",
        onChange: (selected: boolean) => changes.push(selected),
      }),
    );
    const control = getByRole("switch", {
      name: "Desktop banners",
    }) as HTMLInputElement;

    // A real radio-grade control: Space toggling is the platform's own default
    // action on a focusable checkbox input, so the block never reimplements it.
    expect(control.tagName).toBe("INPUT");
    expect(control.type).toBe("checkbox");
    expect(control.checked).toBe(false);

    act(() => {
      control.focus();
    });
    expect(document.activeElement).toBe(control);

    fireEvent.click(control);
    expect(changes).toEqual([true]);
    expect(control.closest("label")?.textContent).toBe("Desktop banners");
  });

  it("renders the track and thumb from the block classes", () => {
    const { getByRole, container } = render(
      createElement(SwitchControl, { label: "Desktop banners" }),
    );
    const control = getByRole("switch", { name: "Desktop banners" });

    expect(container.querySelector(".ui-switch-track")).not.toBeNull();
    expect(container.querySelector(".ui-switch-thumb")).not.toBeNull();
    const root = control.closest(".ui-switch");
    expect(classesOf(root)).toContain("ui-switch");
    expect(root?.textContent).toBe("Desktop banners");
  });

  it("announces its disabled state and refuses to toggle", () => {
    const changes: boolean[] = [];
    const { getByRole } = render(
      createElement(SwitchControl, {
        label: "Desktop banners",
        isDisabled: true,
        onChange: (selected: boolean) => changes.push(selected),
      }),
    );
    const control = getByRole("switch", { name: "Desktop banners" });

    // React Aria puts the state on the control itself, where the tokens read it.
    expect(control.closest(".ui-switch")?.getAttribute("data-disabled")).toBe(
      "true",
    );
    fireEvent.click(control);
    expect(changes).toEqual([]);
  });
});

describe("Badge — a word, not an emoji", () => {
  it("carries the tone and the block classes", () => {
    const { getByText } = render(<Badge tone="warning">out of date</Badge>);
    const badge = getByText("out of date");
    expect(classesOf(badge)).toContain("ui-badge");
    expect(classesOf(badge)).toContain("ui-badge--warning");
  });
});

describe("ListRow — the row block", () => {
  it("renders its slots", () => {
    const { getByText, container } = render(
      createElement(ListRow, {
        title: "TICK-42",
        subtitle: "Fix the smoke test",
        leadingIcon: "icon-code",
        trailing: <Badge tone="success">passed</Badge>,
      }),
    );

    expect(getByText("TICK-42")).toBeTruthy();
    expect(getByText("Fix the smoke test")).toBeTruthy();
    expect(getByText("passed")).toBeTruthy();
    expect(container.querySelector("use")?.getAttribute("href")).toBe(
      "/assets/icons/sprite.svg#icon-code",
    );
    expect(classesOf(container.firstElementChild)).toContain("ui-list-row");
  });

  it("is one tab stop that presses with the keyboard when pressable", () => {
    let presses = 0;
    const { getByRole } = render(
      createElement(ListRow, {
        title: "TICK-42",
        accessibleLabel: "Open run TICK-42",
        onPress: () => {
          presses += 1;
        },
      }),
    );
    const row = getByRole("button", { name: "Open run TICK-42" });

    expect(classesOf(row)).toContain("ui-list-row--pressable");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyUp(row, { key: "Enter" });
    expect(presses).toBe(1);
  });

  it("announces a disabled pressable row and refuses the press", () => {
    let presses = 0;
    const { getByRole } = render(
      createElement(ListRow, {
        title: "TICK-42",
        accessibleLabel: "Open run TICK-42",
        isDisabled: true,
        onPress: () => {
          presses += 1;
        },
      }),
    );
    const row = getByRole("button", { name: "Open run TICK-42" });

    expect(row.getAttribute("data-disabled")).toBe("true");
    fireEvent.click(row);
    expect(presses).toBe(0);
  });
});

describe("ListGroup / ListGroupRow — the one inset grouped list", () => {
  it("renders a header, a list of rows and a footer", () => {
    const { getByRole, getByText, container } = render(
      <ListGroup title="Appearance" footer="Applies at once.">
        <ListGroupRow title="Theme" trailing="Default" />
        <ListGroupRow
          title="Accent colour"
          subtitle="Follows the system by default"
        />
      </ListGroup>,
    );

    expect(getByRole("heading", { level: 3, name: "Appearance" })).toBeTruthy();
    expect(getByText("Applies at once.")).toBeTruthy();
    expect(getByRole("list").children).toHaveLength(2);
    expect(classesOf(container.querySelector("ul"))).toContain("ui-list-group");
    expect(classesOf(container.firstElementChild)).toContain(
      "ui-list-group-block",
    );
  });

  it("keeps the title leading and the accessory trailing", () => {
    const { container, getByText } = render(
      <ListGroup title="Notifications">
        <ListGroupRow
          title="Desktop notifications"
          subtitle="Show a banner when a run needs you"
          trailing="On"
        />
      </ListGroup>,
    );
    const row = container.querySelector(".ui-list-row--compact");

    expect(row?.firstElementChild?.className).toBe("ui-list-row-main");
    expect(classesOf(row?.lastElementChild ?? null)).toContain(
      "ui-list-row-trailing",
    );
    expect(getByText("On").closest(".ui-list-row-trailing")).not.toBeNull();
  });

  it("renders a navigating row as the box itself, with no class named by the caller", () => {
    const { getByRole, container } = render(
      <MemoryRouter>
        <ListGroup title="Help">
          <ListGroupRow href="/docs" title="Documentation" />
        </ListGroup>
      </MemoryRouter>,
    );
    const link = getByRole("link", { name: "Documentation" });

    expect(classesOf(link)).toContain("ui-list-row");
    expect(classesOf(link)).toContain("ui-list-row--compact");
    expect(classesOf(link)).toContain("ui-list-row--pressable");
    expect(container.querySelectorAll(".ui-list-row")).toHaveLength(1);
  });

  it("navigates from the row's own name when the row also carries an action", () => {
    const { getByRole } = render(
      <MemoryRouter>
        <ListGroup title="Projects">
          <ListGroupRow
            titleHref="/projects/xf"
            title="xf"
            trailing={<button type="button">Reconnect</button>}
          />
        </ListGroup>
      </MemoryRouter>,
    );

    expect(getByRole("link", { name: "xf" })).toBeTruthy();
    expect(getByRole("button", { name: "Reconnect" })).toBeTruthy();
  });

  it("renders the content box on its own, for a row a screen must build", () => {
    const { container, getByText } = render(
      <ListRowContent title="Documentation" trailing="Opens elsewhere" />,
    );

    expect(classesOf(getByText("Documentation"))).toContain(
      "ui-list-row-title",
    );
    expect(classesOf(container.firstElementChild)).toContain(
      "ui-list-row-main",
    );
    expect(getByText("Opens elsewhere")).toBeTruthy();
  });

  it("shows a read-only value in mono", () => {
    const { getByText } = render(<ListGroupValue>~/.x-factory</ListGroupValue>);
    expect(classesOf(getByText("~/.x-factory"))).toContain("ui-list-row-value");
  });
});

describe("PlaceholderRows — the static loading shape of a list", () => {
  it("renders the requested number of rows, hidden from assistive technology", () => {
    const { container } = render(createElement(PlaceholderRows, { count: 4 }));
    const list = container.querySelector("ul");

    expect(list?.getAttribute("aria-hidden")).toBe("true");
    expect(
      container.querySelectorAll(".ui-list-row--placeholder"),
    ).toHaveLength(4);
    // A placeholder is a list row, so it reserves the row height by
    // construction — the loaded list cannot jump.
    expect(container.querySelectorAll(".ui-list-row")).toHaveLength(4);
  });
});

describe("Spinner — one standard inline wait", () => {
  it("announces the wait once and draws the loader glyph", () => {
    const { getByRole } = render(createElement(Spinner));
    const status = getByRole("status");

    expect(status.textContent).toBe("Loading…");
    expect(classesOf(status)).toContain("ui-wait");
    expect(status.querySelector("use")?.getAttribute("href")).toBe(
      "/assets/icons/sprite.svg#icon-loader-2",
    );
  });

  it("takes its copy from the caller", () => {
    const { getByRole } = render(
      createElement(Spinner, { label: "Fetching…" }),
    );
    expect(getByRole("status").textContent).toBe("Fetching…");
  });
});

describe("EmptyState — what is not here, once", () => {
  it("renders the icon, the title as a heading, the message and the action", () => {
    const { getByRole, getByText, container } = render(
      createElement(EmptyState, {
        icon: "icon-search",
        title: "No matches",
        message: "Try a different search.",
        action: createElement(Button, { variant: "secondary" }, "Clear Search"),
      }),
    );

    const heading = getByRole("heading", { level: 2, name: "No matches" });
    expect(classesOf(heading)).toContain("ui-empty-state-title");
    expect(getByText("Try a different search.").className).toContain(
      "ui-empty-state-message",
    );
    expect(getByRole("button", { name: "Clear Search" })).not.toBeNull();
    expect(container.querySelector("use")?.getAttribute("href")).toBe(
      "/assets/icons/sprite.svg#icon-search",
    );
  });

  it("is quiet: the icon is decorative and the block is not a live region", () => {
    const { container, queryByRole } = render(
      createElement(EmptyState, { icon: "icon-folder", title: "No projects" }),
    );

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(queryByRole("status")).toBeNull();
    expect(queryByRole("alert")).toBeNull();
  });

  it("takes the heading level from the page's outline", () => {
    const { getByRole } = render(
      createElement(EmptyState, { title: "Nothing yet", headingLevel: 3 }),
    );
    expect(
      getByRole("heading", { level: 3, name: "Nothing yet" }),
    ).not.toBeNull();
  });

  it("leaves out the parts it does not have", () => {
    const { container } = render(
      createElement(EmptyState, { message: "Only a line of guidance." }),
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector(".ui-empty-state-action")).toBeNull();
    expect(container.textContent).toBe("Only a line of guidance.");
  });
});
