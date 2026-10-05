// src/frontend/hooks/useProviderDescriptors.ts — The providers manifest read
// (spec #133 ticket #147).
//
// Every post-creation surface that renders project connections resolves
// display names and capability-driven actions from the manifest — never from a
// hardcoded id map. All surfaces share the wizard's query key, so the manifest
// is fetched once per session.

import { useQuery } from "@tanstack/react-query";
import type { ProviderDescriptor } from "../connection/types.js";
import { api } from "../lib/api-client.js";
import { QUERY_POLICIES, queryKeys } from "../lib/query-policies.js";

export function useProviderDescriptors() {
  return useQuery<ProviderDescriptor[]>({
    queryKey: queryKeys.providers(),
    queryFn: () => api.providers.getManifest(),
    ...QUERY_POLICIES.providers,
  });
}
