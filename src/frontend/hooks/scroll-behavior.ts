// src/frontend/hooks/scroll-behavior.ts — The scroll behaviour a programmatic
// scroll should use. A reader who asked for reduced motion gets an instant
// jump; everyone else gets the smooth scroll. Falls back to the instant
// behaviour where matchMedia is missing, so nothing depends on the API.

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
