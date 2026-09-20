// test/navigation-persistence.test.ts — Deterministic fetch counting across client navigation routes (XFM-60).

import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  invalidateRuns,
  invalidateTickets,
} from "../src/frontend/lib/query-client.js";
import {
  QUERY_POLICIES,
  queryKeys,
} from "../src/frontend/lib/query-policies.js";

describe("Navigation Persistence & Deterministic Fetch Counting (XFM-60)", () => {
  it("reuses cached queries during Queue -> Runs -> Queue navigation without duplicate network fetches", async () => {
    let ticketsFetchCount = 0;
    let runsFetchCount = 0;

    const mockFetchTickets = async (projectId: string) => {
      ticketsFetchCount++;
      return [{ id: "T-1", title: `Ticket for ${projectId}` }];
    };

    const mockFetchRuns = async () => {
      runsFetchCount++;
      return [{ id: "run-1", status: "implementing" }];
    };

    const client = new QueryClient();

    // 1. User visits /queue (fetches tickets for proj-1)
    const ticketsQueryKey = queryKeys.tickets("proj-1");
    const t1 = await client.fetchQuery({
      queryKey: ticketsQueryKey,
      queryFn: () => mockFetchTickets("proj-1"),
      staleTime: QUERY_POLICIES.tickets.staleTime,
    });
    expect(t1.length).toBe(1);
    expect(ticketsFetchCount).toBe(1);

    // 2. User navigates to /runs (fetches runs)
    const runsQueryKey = queryKeys.runs();
    const r1 = await client.fetchQuery({
      queryKey: runsQueryKey,
      queryFn: () => mockFetchRuns(),
      staleTime: QUERY_POLICIES.runs.staleTime,
    });
    expect(r1.length).toBe(1);
    expect(runsFetchCount).toBe(1);

    // 3. User navigates back to /queue within staleTime (60s)
    // TanStack Query MUST serve from cache; fetch count MUST remain 1!
    const t2 = await client.fetchQuery({
      queryKey: ticketsQueryKey,
      queryFn: () => mockFetchTickets("proj-1"),
      staleTime: QUERY_POLICIES.tickets.staleTime,
    });
    expect(t2).toEqual(t1);
    expect(ticketsFetchCount).toBe(1); // 0 additional network calls!

    // 4. User navigates back to /runs within staleTime (15s)
    const r2 = await client.fetchQuery({
      queryKey: runsQueryKey,
      queryFn: () => mockFetchRuns(),
      staleTime: QUERY_POLICIES.runs.staleTime,
    });
    expect(r2).toEqual(r1);
    expect(runsFetchCount).toBe(1); // 0 additional network calls!

    // 5. Explicit user action: user clicks refresh or a ticket action invalidates tickets
    await invalidateTickets("proj-1", client);

    // Next fetch MUST issue a fresh network request
    const t3 = await client.fetchQuery({
      queryKey: ticketsQueryKey,
      queryFn: () => mockFetchTickets("proj-1"),
      staleTime: QUERY_POLICIES.tickets.staleTime,
    });
    expect(t3).toEqual(t1);
    expect(ticketsFetchCount).toBe(2); // Exactly 2 calls now
  });

  it("preserves active run detail during Runs -> RunDetail -> Runs navigation", async () => {
    let runDetailFetchCount = 0;
    const mockFetchRunDetail = async (id: string) => {
      runDetailFetchCount++;
      return { id, status: "verifying", diff: "diff-content" };
    };

    const client = new QueryClient();
    const runId = "run-persistent-detail";
    const runKey = queryKeys.run(runId);

    // User navigates to /runs/:id
    const detail1 = await client.fetchQuery({
      queryKey: runKey,
      queryFn: () => mockFetchRunDetail(runId),
      staleTime: QUERY_POLICIES.run.staleTime,
    });
    expect(detail1.id).toBe(runId);
    expect(runDetailFetchCount).toBe(1);

    // User navigates away to /runs and back to /runs/:id within 10s staleTime
    const detail2 = await client.fetchQuery({
      queryKey: runKey,
      queryFn: () => mockFetchRunDetail(runId),
      staleTime: QUERY_POLICIES.run.staleTime,
    });
    expect(detail2).toEqual(detail1);
    expect(runDetailFetchCount).toBe(1); // Served from cache

    // Invalidation triggers refetch
    invalidateRuns(client);
    const detail3 = await client.fetchQuery({
      queryKey: runKey,
      queryFn: () => mockFetchRunDetail(runId),
      staleTime: QUERY_POLICIES.run.staleTime,
    });
    expect(detail3).toEqual(detail1);
    expect(runDetailFetchCount).toBe(2);
  });
});
