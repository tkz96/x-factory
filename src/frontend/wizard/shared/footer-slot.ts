// src/frontend/wizard/shared/footer-slot.ts — The element the assistant sheet
// reserves for the active step's actions (#268).
//
// A step renders its Back and Continue buttons through `WizardFooter`, which
// puts them in the sheet's fixed action bar rather than inside the scrolling
// body. `undefined` means there is no sheet (a step mounted on its own in a
// test): the actions then render where they are written.

import { createContext } from "react";

export const WizardFooterSlot = createContext<HTMLElement | null | undefined>(
  undefined,
);
