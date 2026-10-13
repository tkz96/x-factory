// src/frontend/components/ui/useMediaQuery.ts — Whether a CSS media query currently matches
// (#262). Used where a layout changes shape at phone width (the inspector becomes a sheet; a
// segmented control collapses to a select). It lives beside the blocks because a block may reach
// only itself and `src/shared`, and SegmentedControl needs it. An empty query never matches, so a
// caller that has no threshold to watch gets `false`. Falls back to false where matchMedia is
// missing, so the desktop layout is the default.

import { useEffect, useState } from "react";

function matchesNow(query: string): boolean {
  return (
    query !== "" &&
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesNow(query));

  useEffect(() => {
    if (
      query === "" ||
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
