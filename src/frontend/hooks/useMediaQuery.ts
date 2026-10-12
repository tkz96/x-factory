// src/frontend/hooks/useMediaQuery.ts — Whether a CSS media query currently matches (#262).
// Used where a layout changes shape at phone width (the inspector becomes a sheet). Falls back to
// false where matchMedia is missing, so the desktop layout is the default.

import { useEffect, useState } from "react";

function matchesNow(query: string): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesNow(query));

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}
