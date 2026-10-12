// src/frontend/components/ui/Spinner.tsx — The one wait indicator (#251,
// spec #241).
//
// Small inline waits all look the same: the sprite's loader glyph, spinning.
// Under `prefers-reduced-motion` the tokens drop every transition to 0ms and
// the glyph becomes a static indicator. The wait is announced once, through the
// status role, with a visually hidden label.

export interface SpinnerProps {
  /** The announced wait. Canonical copy lives in the feedback copy map. */
  label?: string;
  /** Visually hidden by default; a visible hint is the caller's choice. */
  className?: string | undefined;
}

export function Spinner({ label = "Loading…", className }: SpinnerProps) {
  const classes = ["ui-wait"];
  if (className !== undefined) classes.push(className);
  return (
    <span className={classes.join(" ")} role="status">
      <svg className="icon icon-lg icon-spin" aria-hidden="true">
        <use href="/assets/icons/sprite.svg#icon-loader-2" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
