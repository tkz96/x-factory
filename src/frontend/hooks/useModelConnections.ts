// src/frontend/hooks/useModelConnections.ts — queries and mutations for model
// connections (#276/#277). Every mutation refreshes only the model-connections
// key (XFM-43 targeted invalidation).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ModelApiType,
  ModelRecordPatch,
} from "../../shared/model-connection-types.js";
import { api } from "../lib/api-client.js";
import { QUERY_POLICIES, queryKeys } from "../lib/query-policies.js";

export function useModelConnections() {
  return useQuery({
    queryKey: queryKeys.modelConnections(),
    queryFn: () => api.listModelConnections(),
    ...QUERY_POLICIES.modelConnections,
  });
}

export function useModelConnectionMutations() {
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: queryKeys.modelConnections(),
    });

  return {
    create: useMutation({
      mutationFn: (payload: {
        name: string;
        apiType: ModelApiType;
        baseUrl?: string | undefined;
        apiKey?: string | undefined;
      }) => api.createModelConnection(payload),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        ...payload
      }: {
        id: string;
        name?: string | undefined;
        baseUrl?: string | undefined;
        apiKey?: string | undefined;
      }) => api.updateModelConnection(id, payload),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.deleteModelConnection(id),
      onSuccess: refresh,
    }),
    check: useMutation({
      mutationFn: (id: string) => api.checkModelConnection(id),
      onSuccess: refresh,
    }),
    addModel: useMutation({
      mutationFn: ({ id, modelId }: { id: string; modelId: string }) =>
        api.addConnectionModel(id, modelId),
      onSuccess: refresh,
    }),
    updateModel: useMutation({
      mutationFn: ({
        id,
        modelId,
        patch,
      }: {
        id: string;
        modelId: string;
        patch: ModelRecordPatch;
      }) => api.updateConnectionModel(id, modelId, patch),
      onSuccess: refresh,
    }),
    removeModel: useMutation({
      mutationFn: ({ id, modelId }: { id: string; modelId: string }) =>
        api.removeConnectionModel(id, modelId),
      onSuccess: refresh,
    }),
  };
}
