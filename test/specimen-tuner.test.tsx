// test/specimen-tuner.test.tsx — the specimen's Tune panel overrides tokens on
// the root only while it is shown, and copies only what changed (spec #292).

import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { SpecimenTuner } from "../src/frontend/components/specimen/SpecimenTuner.js";

const root = () => document.documentElement;

afterEach(() => {
  cleanup();
  localStorage.clear();
  root().removeAttribute("style");
});

afterAll(async () => {
  await unregisterHappyDom();
});

/** happy-dom needs the native setter and an input event before React sees a value (see command-palette). */
function setValue(el: HTMLInputElement, value: string) {
  act(() => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    fireEvent.keyUp(el);
  });
}

function tuner() {
  const view = render(<SpecimenTuner />);
  const slider =
    view.container.querySelector<HTMLInputElement>("#tune--radius-card");
  if (slider === null) throw new Error("no radius card slider");
  return { view, slider };
}

describe("the specimen Tune panel", () => {
  it("sets a token on the root while shown, marks it changed, and undoes it", () => {
    const { view, slider } = tuner();
    setValue(slider, "22");
    expect(root().style.getPropertyValue("--radius-card")).toBe("22px");
    expect(view.getByRole("button", { name: "Copy Changes (1)" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Undo" }));
    expect(root().style.getPropertyValue("--radius-card")).toBe("");
  });

  it("writes each kind of token in its own unit", () => {
    const { view } = tuner();
    const set = (id: string, value: string) => {
      const control = view.container.querySelector(`#${id}`);
      if (control instanceof HTMLSelectElement) {
        fireEvent.change(control, { target: { value } });
      } else if (control instanceof HTMLInputElement) {
        setValue(control, value);
      } else {
        throw new Error(`no control ${id}`);
      }
    };
    set("tune--corner-shape", "1.2");
    set("tune--text-body", "14");
    set("tune--icon-stroke", "1.75");
    set("tune--text-headline-weight", "600");
    set("tune--accent", "#336699");
    expect(root().style.getPropertyValue("--corner-shape")).toBe(
      "superellipse(1.2)",
    );
    expect(root().style.getPropertyValue("--text-body")).toBe("0.875rem");
    expect(root().style.getPropertyValue("--icon-stroke")).toBe("1.75");
    expect(root().style.getPropertyValue("--text-headline-weight")).toBe("600");
    expect(root().style.getPropertyValue("--accent")).toBe("#336699");
  });

  it("keeps the overrides for the next visit and removes them from the root on leaving", () => {
    const { view, slider } = tuner();
    setValue(slider, "24");
    view.unmount();
    expect(root().style.getPropertyValue("--radius-card")).toBe("");
    expect(
      JSON.parse(localStorage.getItem("xf_specimen_tune") ?? "{}"),
    ).toEqual({
      "--radius-card": "24",
    });

    render(<SpecimenTuner />);
    expect(root().style.getPropertyValue("--radius-card")).toBe("24px");
  });

  it("copies only the changed tokens as CSS, with the old value", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied = text;
          return Promise.resolve();
        },
      },
    });
    const { view, slider } = tuner();
    setValue(slider, "20");
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy Changes (1)" }));
    });
    expect(copied).toContain("1 change(s)");
    expect(copied).toMatch(/--radius-card: 20px; \/\* was .*\*\//);
    expect(copied).not.toContain("--radius-sm");
    expect(view.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("resets every override, and hides and shows the panel", () => {
    const { view, slider } = tuner();
    setValue(slider, "30");
    fireEvent.click(view.getByRole("button", { name: "Reset All" }));
    expect(root().style.getPropertyValue("--radius-card")).toBe("");

    fireEvent.click(view.getByRole("button", { name: "Hide" }));
    expect(view.queryByRole("complementary")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Tune" }));
    expect(
      view.getByRole("complementary", { name: "Tune design tokens" }),
    ).toBeTruthy();
  });
});
