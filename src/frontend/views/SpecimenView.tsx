// src/frontend/views/SpecimenView.tsx — The dev-only specimen page (spec #292,
// step 2, #294). It lists every block of components/ui/ and the overlays, the
// type scale and the corner comparison, and switches the root data attributes
// so one page shows the whole system in each theme, appearance and contrast.
//
// This route exists only in development builds: routes.tsx declares it behind
// import.meta.env.DEV, so the production bundle has no trace of this module.

import "./SpecimenView.css";

import { useEffect, useState } from "react";
import { SpecimenBlocks } from "../components/specimen/SpecimenBlocks.js";
import { SpecimenControls } from "../components/specimen/SpecimenControls.js";
import { SpecimenOverlays } from "../components/specimen/SpecimenOverlays.js";
import {
  SpecimenCorners,
  SpecimenTypeScale,
} from "../components/specimen/SpecimenSurfaces.js";
import type { SpecimenSettings } from "../components/specimen/specimen-settings.js";
import { applyThemeToDocument, useTheme } from "../hooks/useTheme.js";

/** Automatic follows the OS query, as the app's own setting does. */
function resolveSpecimenTransparency(
  setting: SpecimenSettings["transparency"],
): "reduced" | "full" | undefined {
  if (setting !== "automatic") return setting;
  const query = globalThis.matchMedia?.(
    "(prefers-reduced-transparency: reduce)",
  );
  return query?.matches ? "reduced" : undefined;
}

/** The app's own settings, read once when the specimen mounts. */
function snapshotOf(global: ReturnType<typeof useTheme>): AppSnapshot {
  return {
    theme: global.theme,
    resolvedAppearance: global.resolvedAppearance,
    contrast: global.contrast,
    transparency: global.resolvedTransparency,
    readableFont: global.readableFont,
  };
}

type AppSnapshot = Parameters<typeof applyThemeToDocument>[0];

export function SpecimenView() {
  const global = useTheme();
  const [snapshot] = useState(() => snapshotOf(global));
  const [settings, setSettings] = useState<SpecimenSettings>({
    theme: "default",
    appearance: global.resolvedAppearance,
    contrast: global.contrast,
    transparency: "automatic",
    readableFont: global.readableFont,
  });

  // The specimen owns the root attributes while it is shown; on leaving it
  // hands them back to the app's own settings.
  useEffect(() => {
    applyThemeToDocument({
      theme: settings.theme,
      resolvedAppearance: settings.appearance,
      contrast: settings.contrast,
      transparency: resolveSpecimenTransparency(settings.transparency),
      readableFont: settings.readableFont,
    });
    return () => applyThemeToDocument(snapshot);
  }, [settings, snapshot]);

  return (
    <main className="specimen" aria-labelledby="specimen-title">
      <header className="specimen-header">
        <h1 id="specimen-title" className="specimen-title">
          Specimen
        </h1>
        <p className="specimen-note">
          Development only. Every block in components/ui and the overlays.
        </p>
      </header>
      <SpecimenControls settings={settings} onChange={setSettings} />
      <SpecimenBlocks />
      <SpecimenOverlays />
      <SpecimenTypeScale />
      <SpecimenCorners />
    </main>
  );
}

export default SpecimenView;
