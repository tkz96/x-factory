// src/frontend/components/welcome/HomeRoute.tsx — Where the app's landing goes
// (#269, spec #241 story 111).
//
// The index route decides one thing from real state: the welcome while setup is
// incomplete, Tickets once every step is done or the user chose to set up later. That decision is this file's
// whole job — the welcome itself is a screen, and the checklist derivation it
// reads never ticks a step whose state has not answered yet, so a query still in
// flight shows the one spinner rather than sending the user somewhere the app
// cannot be sure about. A setup that could not be read stays on the welcome,
// where the canonical error and its retry are.

import "./HomeRoute.css";

import { Navigate } from "react-router-dom";
import { useSetupChecklist } from "../../hooks/useSetupChecklist.js";
import { isSetupDeferred } from "../../lib/setup-later.js";
import { STATE_COPY } from "../feedback/copy-map.js";
import { Spinner } from "../ui/Spinner.js";

export function HomeRoute() {
  const { derived, checklist } = useSetupChecklist();

  if (derived.state === "loading") {
    return (
      <div className="home-gate">
        <Spinner label={STATE_COPY.loading} />
      </div>
    );
  }

  // "I'll set up later" on the welcome sends later visits to Tickets too.
  const toTickets = checklist.complete || isSetupDeferred();
  return <Navigate to={toTickets ? "/tickets" : "/welcome"} replace />;
}
