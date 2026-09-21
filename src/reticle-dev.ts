// Dev-only. Imported automatically by @reticlehq/vite-plugin, so you do not need to import it.
// Self-guards on import.meta.env.DEV, so it is a no-op in a production build.
import {
  registerCapabilities,
  registerStore,
  tanstackQueryStore,
} from "@reticlehq/react";
import { queryClient } from "./frontend/lib/query-client.js";

if (import.meta.env.DEV) {
  registerStore("queryClient", tanstackQueryStore(queryClient));

  registerCapabilities({
    testids: [],
    signals: [],
    stores: ["queryClient"],
  });
}
