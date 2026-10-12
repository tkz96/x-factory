// src/frontend/views/WelcomeView.tsx — The first-run welcome (#269, spec #241
// stories 109–111).
//
// One read region over the setup state (hooks/useSetupChecklist): loading is the
// one spinner, a failure is the canonical error with a retry, and the ready
// state is the three-step checklist. The screen never ticks a step it cannot
// see — the ticks come from the same state the Projects screen, Settings ›
// Models and the Runs list read.
//
// The route stays reachable after setup finishes, where it reads as three
// finished steps; the app's landing (components/welcome/HomeRoute) is what takes
// the user on to Tickets once every step is done.

import { AsyncRegion } from "../components/feedback/AsyncRegion.js";
import { SetupChecklist } from "../components/welcome/SetupChecklist.js";
import { useSetupChecklist } from "../hooks/useSetupChecklist.js";

export function WelcomeView() {
  const { derived, checklist, refetch } = useSetupChecklist();

  return (
    <section id="area-welcome" className="area-view active">
      <AsyncRegion derived={derived} onRetry={refetch}>
        <SetupChecklist checklist={checklist} />
      </AsyncRegion>
    </section>
  );
}
