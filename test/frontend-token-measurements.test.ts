// test/frontend-token-measurements.test.ts — Measurements and colours the
// review found hard-coded now come from tokens.css (#241 review, item 1).

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const tokens = readFileSync("src/frontend/styles/tokens.css", "utf8");

describe("hard-coded values are tokens", () => {
  it("the diagram minimap mask uses the scrim token, not a literal rgba", () => {
    const tsx = readFileSync(
      "src/frontend/components/diagrams/DiagramModal.tsx",
      "utf8",
    );
    // The minimap forwards maskColor into a CSS custom property, so a var()
    // string resolves exactly like the rgba() it replaces.
    expect(tsx).toContain('maskColor="var(--scrim)"');
    expect(tsx).not.toMatch(/rgba\(/);
    expect(tokens).toMatch(/--scrim:\s*rgba\(0, 0, 0, 0\.4\);/);
  });

  it("the settings checkbox offset uses a spacing token", () => {
    const css = readFileSync("src/frontend/views/SettingsView.css", "utf8");
    expect(css).toMatch(
      /\.setting-checkbox\s*\{[^}]*margin-top:\s*var\(--space-/,
    );
    expect(css).not.toMatch(/\.setting-checkbox\s*\{[^}]*margin-top:\s*\d/);
  });

  it("the repository settings inputs reuse the shared form-input focus ring", () => {
    const tsx = readFileSync(
      "src/frontend/components/projects/RepositorySettings.tsx",
      "utf8",
    );
    const css = readFileSync(
      "src/frontend/components/projects/RepositorySettings.css",
      "utf8",
    );
    expect(tsx).toContain('className="form-input repo-settings-input"');
    expect(tsx).toContain(
      'className="form-input repo-settings-input repo-settings-input--mono"',
    );
    // The focus ring lives in styles/shared/forms.css only.
    expect(css).not.toContain("box-shadow");
    expect(css).not.toContain(":focus-visible");
  });
});
