// test/feedback-components.test.ts — Rendering tests for the feedback
// primitive family: AsyncRegion (all five states + suppressed diagnostics),
// FeedbackBanner (tones, partial items, rate-limit timed guidance),
// FieldFeedback, and RetryAction.

import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { AsyncRegion } from "../src/frontend/components/feedback/AsyncRegion.js";
import { FeedbackBanner } from "../src/frontend/components/feedback/FeedbackBanner.js";
import { FieldFeedback } from "../src/frontend/components/feedback/FieldFeedback.js";
import { RetryAction } from "../src/frontend/components/feedback/RetryAction.js";
import type {
  AsyncRegionState,
  DerivedAsyncState,
} from "../src/frontend/components/feedback/types.js";

function derived(
  state: AsyncRegionState,
  suppressed: AsyncRegionState[] = [],
  error?: unknown,
): DerivedAsyncState {
  return { state, suppressed, error };
}

function render(element: React.ReactElement): string {
  return renderToString(element);
}

describe("AsyncRegion — five-state taxonomy", () => {
  it("renders loading as an indeterminate spinner in a reserved region", () => {
    const html = render(
      React.createElement(AsyncRegion, { derived: derived("loading") }),
    );
    expect(html).toContain("async-region--loading");
    expect(html).toContain("icon-loader-2");
    expect(html).toContain("icon-spin");
    expect(html).toContain("Loading…");
    expect(html).toContain('role="status"');
  });

  it("renders a primary error with normalized copy and a retry affordance", () => {
    let retried = false;
    const html = render(
      React.createElement(AsyncRegion, {
        derived: derived("error", [], {
          code: "AUTH_INVALID",
          context: "VERIFY",
        }),
        onRetry: () => {
          retried = true;
        },
      }),
    );
    expect(html).toContain("async-region--error");
    expect(html).toContain("icon-alert-circle");
    expect(html).toContain(
      "The credentials were rejected. Check the token and try again.",
    );
    expect(html).toContain(">Try again</button>");
    expect(retried).toBe(false);
  });

  it("renders rate-limit timed guidance with a disabled retry", () => {
    const html = render(
      React.createElement(AsyncRegion, {
        derived: derived("error", [], {
          code: "RATE_LIMITED",
          context: "TICKETS",
          retryAfterMs: 30_000,
        }),
        onRetry: () => {},
      }),
    );
    expect(html).toContain("Retry available in 30s");
    expect(html).toContain('disabled=""');
  });

  it("falls back to canonical copy for non-normalized error payloads", () => {
    const html = render(
      React.createElement(AsyncRegion, {
        derived: derived("error", [], new Error("raw provider body")),
      }),
    );
    expect(html).toContain("The request failed. Try again.");
    expect(html).not.toContain("raw provider body");
  });

  it("renders empty guidance, overridable per region", () => {
    const html = render(
      React.createElement(AsyncRegion, { derived: derived("empty") }),
    );
    expect(html).toContain("async-region--empty");
    expect(html).toContain("Nothing here yet.");

    const custom = render(
      React.createElement(AsyncRegion, {
        derived: derived("empty"),
        emptyCopy: "Connect a repository to see tickets.",
      }),
    );
    expect(custom).toContain("Connect a repository to see tickets.");
    expect(custom).not.toContain("Nothing here yet.");
  });

  it("renders the empty state's optional call-to-action", () => {
    const html = render(
      React.createElement(AsyncRegion, {
        derived: derived("empty"),
        emptyCopy: "No projects yet.",
        emptyAction: React.createElement(
          "button",
          { type: "button", className: "btn-primary btn-sm" },
          "Onboard Project",
        ),
      }),
    );
    expect(html).toContain("async-region-actions");
    expect(html).toContain("Onboard Project");
  });

  it("renders ready content with no feedback chrome", () => {
    const html = render(
      React.createElement(
        AsyncRegion,
        { derived: derived("ready") },
        React.createElement("li", null, "run-1"),
      ),
    );
    expect(html).toContain("run-1");
    expect(html).not.toContain("feedback-banner");
    expect(html).not.toContain("async-region-stale");
  });

  it("renders partial as content plus a warning banner listing failed parts", () => {
    const html = render(
      React.createElement(
        AsyncRegion,
        {
          derived: derived("partial"),
          failedParts: ["Repository discovery", "Ticket listing"],
        },
        React.createElement("li", null, "run-1"),
      ),
    );
    expect(html).toContain("run-1");
    expect(html).toContain("feedback-banner--warning");
    expect(html).toContain("Some results could not load.");
    expect(html).toContain("Repository discovery");
    expect(html).toContain("Ticket listing");
  });

  it("renders stale as content plus the out-of-date badge and refresh action", () => {
    const html = render(
      React.createElement(
        AsyncRegion,
        { derived: derived("stale"), onRetry: () => {} },
        React.createElement("li", null, "run-1"),
      ),
    );
    expect(html).toContain("run-1");
    expect(html).toContain("async-region-stale-badge");
    expect(html).toContain("Out of date");
    expect(html).toContain(">Refresh</button>");
  });

  it("stale + failed refresh keeps the stale UI and renders the error context + retry inline", () => {
    const html = render(
      React.createElement(
        AsyncRegion,
        {
          derived: derived("stale", ["error"], {
            code: "RATE_LIMITED",
            context: "DISCOVERY",
            retryAfterMs: 5000,
          }),
          onRetry: () => {},
        },
        React.createElement("li", null, "run-1"),
      ),
    );
    expect(html).toContain("async-region-stale-badge");
    expect(html).toContain(
      "The provider is limiting requests, so repositories could not load. Wait a moment, then try again.",
    );
    expect(html).toContain("Retry available in 5s");
  });

  it("never discards a suppressed error: a failed refresh with data renders the error banner beside the content", () => {
    const html = render(
      React.createElement(
        AsyncRegion,
        {
          derived: derived("ready", ["error"], {
            code: "PERMISSION",
            context: "PR",
          }),
          onRetry: () => {},
        },
        React.createElement("li", null, "run-1"),
      ),
    );
    expect(html).toContain("run-1");
    expect(html).toContain("feedback-banner--error");
    expect(html).toContain(
      "The token does not have the permissions required to create the pull request.",
    );
  });
});

describe("FeedbackBanner — tones, partial items, timed guidance", () => {
  it("renders each tone with its semantic class", () => {
    for (const tone of ["info", "warning", "error"] as const) {
      const html = render(
        React.createElement(FeedbackBanner, { tone, message: "Copy." }),
      );
      expect(html).toContain(`feedback-banner--${tone}`);
      expect(html).toContain("Copy.");
      expect(html).toContain('role="status"');
    }
  });

  it("lists partial items inline", () => {
    const html = render(
      React.createElement(FeedbackBanner, {
        tone: "warning",
        message: "Some results could not load.",
        items: ["Repositories"],
      }),
    );
    expect(html).toContain("<ul");
    expect(html).toContain("<li>Repositories</li>");
  });

  it("renders an enabled retry when no rate limit applies", () => {
    const html = render(
      React.createElement(FeedbackBanner, {
        tone: "error",
        message: "Copy.",
        onRetry: () => {},
      }),
    );
    expect(html).toContain(">Try again</button>");
    expect(html).not.toContain("Retry available");
    expect(html).not.toContain("disabled");
  });

  it("disables the retry behind rate-limit countdown guidance", () => {
    const html = render(
      React.createElement(FeedbackBanner, {
        tone: "error",
        message: "Copy.",
        retryAfterMs: 1500,
        onRetry: () => {},
      }),
    );
    expect(html).toContain("Retry available in 2s");
    expect(html).toContain('disabled=""');
  });

  it("renders no retry affordance without a retry handler", () => {
    const html = render(
      React.createElement(FeedbackBanner, { tone: "info", message: "Copy." }),
    );
    expect(html).not.toContain("<button");
  });
});

describe("FieldFeedback — input states", () => {
  it("renders nothing in the default state", () => {
    const html = render(
      React.createElement(FieldFeedback, { state: "default" }),
    );
    expect(html).toBe("");
  });

  it("renders each non-default state with its icon and message", () => {
    const expectations = {
      valid: "icon-check-circle-2",
      invalid: "icon-x-circle",
      warning: "icon-alert-circle",
      indeterminate: "icon-info",
    } as const;
    for (const [state, icon] of Object.entries(expectations)) {
      const html = render(
        React.createElement(FieldFeedback, {
          state: state as keyof typeof expectations,
          message: "Field note.",
          id: "field-note",
        }),
      );
      expect(html).toContain(`field-feedback--${state}`);
      expect(html).toContain(icon);
      expect(html).toContain("Field note.");
      expect(html).toContain('id="field-note"');
      expect(html).toContain('role="status"');
    }
  });
});

describe("RetryAction — the uniform retry affordance", () => {
  it("uses the canonical retry label and the refresh icon", () => {
    const html = render(
      React.createElement(RetryAction, { onRetry: () => {} }),
    );
    expect(html).toContain(">Try again</button>");
    expect(html).toContain("icon-refresh-cw");
    expect(html).toContain("retry-action");
  });

  it("accepts a custom label (the stale-region Refresh) and disabled state", () => {
    const html = render(
      React.createElement(RetryAction, {
        onRetry: () => {},
        disabled: true,
        label: "Refresh",
      }),
    );
    expect(html).toContain(">Refresh</button>");
    expect(html).toContain('disabled=""');
  });
});
