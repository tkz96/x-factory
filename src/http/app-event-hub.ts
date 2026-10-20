// src/http/app-event-hub.ts — One shared poller behind every /api/events connection (#257, spec #241).
//
// The API process used to run one 300 ms JOIN query per connection. The hub reads new events once
// per tick and fans them out. It starts with the first subscriber and stops with the last, and a
// stale cursor is replayed in bounded pages instead of one unbounded query.

import type { Repositories } from "../composition-root.js";
import * as runs from "../runs.js";
import type { AppEventEnvelope } from "../shared/types.js";
import { SSE_KEEPALIVE_MS } from "./sse-timing.js";

export const APP_EVENTS_POLL_MS = 300;
export const APP_EVENTS_KEEPALIVE_MS = SSE_KEEPALIVE_MS;
export const APP_EVENTS_REPLAY_PAGE_SIZE = 500;

export interface AppEventSubscriber {
  /** Receives events in ascending id order; never an id at or below the subscriber's cursor. */
  onEvents(events: AppEventEnvelope[]): void;
  /** The shared poll failed; the subscriber is dropped and must close its stream. */
  onError(error: unknown): void;
}

export interface AppEventHubOptions {
  pollMs?: number;
  pageSize?: number;
  log?: (message: string, error: unknown) => void;
}

type ReadEvents = (sinceId: number, limit: number) => AppEventEnvelope[];

export class AppEventHub {
  private readonly subscribers = new Set<AppEventSubscriber>();
  private readonly pollMs: number;
  private readonly pageSize: number;
  private readonly log: (message: string, error: unknown) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Highest event id already fanned out; only meaningful while polling. */
  private head = 0;

  constructor(
    private readonly read: ReadEvents,
    options: AppEventHubOptions = {},
  ) {
    this.pollMs = options.pollMs ?? APP_EVENTS_POLL_MS;
    this.pageSize = options.pageSize ?? APP_EVENTS_REPLAY_PAGE_SIZE;
    this.log =
      options.log ??
      ((message, error) => {
        console.error(message, error);
      });
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  get isPolling(): boolean {
    return this.timer !== null;
  }

  /**
   * Replays every event above `cursor` (in pages), then delivers live events.
   * Returns an unsubscribe function. A failed replay calls onError and subscribes nothing.
   */
  subscribe(cursor: number, subscriber: AppEventSubscriber): () => void {
    const wasPolling = this.isPolling;
    try {
      this.catchUp(cursor, subscriber, wasPolling);
    } catch (error) {
      this.log("[X-Factory] App event replay failed", error);
      subscriber.onError(error);
      return () => {};
    }
    this.subscribers.add(subscriber);
    if (!wasPolling) {
      this.timer = setInterval(() => this.tick(), this.pollMs);
    }
    return () => this.unsubscribe(subscriber);
  }

  private catchUp(
    cursor: number,
    subscriber: AppEventSubscriber,
    wasPolling: boolean,
  ): void {
    let since = cursor;
    for (;;) {
      const page = this.read(since, this.pageSize);
      // While polling, the shared head already covers newer events; the next tick delivers them.
      const events = wasPolling ? page.filter((e) => e.id <= this.head) : page;
      if (events.length > 0) subscriber.onEvents(events);
      const last = page.at(-1);
      if (!last) break;
      since = last.id;
      if (wasPolling && last.id >= this.head) break;
      if (page.length < this.pageSize) break;
    }
    if (!wasPolling) this.head = Math.max(since, cursor);
  }

  private unsubscribe(subscriber: AppEventSubscriber): void {
    this.subscribers.delete(subscriber);
    if (this.subscribers.size === 0) this.stop();
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.subscribers.size === 0) return;
    try {
      for (;;) {
        const page = this.read(this.head, this.pageSize);
        const last = page.at(-1);
        if (!last) return;
        this.head = last.id;
        for (const subscriber of [...this.subscribers]) {
          try {
            subscriber.onEvents(page);
          } catch (error) {
            this.log("[X-Factory] App event delivery failed", error);
            this.unsubscribe(subscriber);
            subscriber.onError(error);
          }
        }
        if (this.subscribers.size === 0) return;
        if (page.length < this.pageSize) return;
      }
    } catch (error) {
      this.log("[X-Factory] App event poll failed", error);
      const dropped = [...this.subscribers];
      this.subscribers.clear();
      this.stop();
      for (const subscriber of dropped) subscriber.onError(error);
    }
  }
}

const hubs = new WeakMap<Repositories, AppEventHub>();

/** The one hub for this process's repositories. */
export function appEventHubFor(repos: Repositories): AppEventHub {
  let hub = hubs.get(repos);
  if (!hub) {
    hub = new AppEventHub((sinceId, limit) =>
      runs.getAppEvents(repos, sinceId, limit),
    );
    hubs.set(repos, hub);
  }
  return hub;
}
