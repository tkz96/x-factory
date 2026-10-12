// src/frontend/hooks/scroll-behavior.ts — The scroll behaviour a programmatic
// scroll should use. A reader who asked for reduced motion gets an instant
// jump; everyone else gets the smooth scroll. Where matchMedia is missing the
// preference is simply not asked for — the guard keeps the call off an API that
// is not there, and the smooth answer stands.

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** "smooth", unless the reader asked for reduced motion — then "auto". */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
