// public/js/queue.ts — Work item queue, ticket cards, instant search, and run pre-fill.

import type { Ticket } from "../../src/shared/types.js";
import { clearElement, el } from "./dom.js";
import { openNewRunModal } from "./router.js";
import { state } from "./state.js";
import { $, api } from "./utils.js";

let onSelectTicketCallback: ((ticket: Ticket) => void) | null = null;

export function setOnSelectTicket(fn: (ticket: Ticket) => void): void {
  onSelectTicketCallback = fn;
}

function handleSelectTicket(ticket: Ticket): void {
  const inputTicketId = $<HTMLInputElement>("#input-ticket-id");
  const inputTicketTitle = $<HTMLInputElement>("#input-ticket-title");
  const inputBranch = $<HTMLInputElement>("#input-branch");
  const inputCriteria = $<HTMLTextAreaElement>("#input-criteria");
  const inputPlan = $<HTMLTextAreaElement>("#input-plan");

  if (inputTicketId) inputTicketId.value = ticket.id;
  if (inputTicketTitle) inputTicketTitle.value = ticket.title;
  if (inputBranch) inputBranch.value = "";
  if (inputCriteria) {
    inputCriteria.value = (ticket.acceptanceCriteria || []).join("\n");
  }
  if (inputPlan && !inputPlan.value) {
    inputPlan.value = `1. Understand ticket requirements\n2. Implement changes for ${ticket.title}\n3. Verify test suite passes without regressions\n4. Review and deliver`;
  }

  if (onSelectTicketCallback) {
    onSelectTicketCallback(ticket);
  }
  openNewRunModal();
}

function createTicketFooter(t: Ticket): HTMLElement {
  const extUrlEl = t.url
    ? el("a", {
        href: t.url,
        target: "_blank",
        rel: "noopener",
        className: "text-muted",
        style: { "font-size": "0.75rem" },
        textContent: `View on ${t.provider || "tracker"} ↗`,
        onClick: (e: MouseEvent) => e.stopPropagation(),
      })
    : null;

  return el("div", { className: "ticket-footer" }, [
    el("div", { className: "ticket-tags" }, [
      el(
        "span",
        {
          className: "filter-pill",
          style: { "font-size": "0.7rem", padding: "0.2rem 0.5rem" },
        },
        [el("span", { className: "pill-dot" }), "agentic-workflow"],
      ),
    ]),
    extUrlEl,
  ]);
}

function createTicketCard(t: Ticket): HTMLElement {
  const criteriaItems = (t.acceptanceCriteria || [])
    .slice(0, 3)
    .map((c) => el("li", { textContent: c }));

  const btnStart = el("button", {
    className: "btn-primary btn-sm btn-start-ticket",
    textContent: "Start Run",
    attrs: { "data-id": t.id },
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      handleSelectTicket(t);
    },
  });

  return el(
    "div",
    {
      className: "ticket-card",
      onClick: () => handleSelectTicket(t),
    },
    [
      el("div", { className: "ticket-card-header" }, [
        el("div", { className: "ticket-badges" }, [
          el("span", { className: "ticket-key", textContent: t.id }),
          el("span", {
            className: "ticket-provider",
            textContent: t.provider || "",
          }),
        ]),
        btnStart,
      ]),
      el("h3", { className: "ticket-title", textContent: t.title }),
      criteriaItems.length > 0
        ? el("ul", { className: "ticket-criteria" }, criteriaItems)
        : null,
      createTicketFooter(t),
    ],
  );
}

function createEmptyQueueSvg(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "32");
  svg.setAttribute("height", "32");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "3");
  rect.setAttribute("y", "4");
  rect.setAttribute("width", "18");
  rect.setAttribute("height", "18");
  rect.setAttribute("rx", "2");
  rect.setAttribute("ry", "2");
  svg.appendChild(rect);

  for (const [x1, x2] of [
    ["16", "16"],
    ["8", "8"],
  ]) {
    const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l.setAttribute("x1", x1);
    l.setAttribute("y1", "2");
    l.setAttribute("x2", x2);
    l.setAttribute("y2", "6");
    svg.appendChild(l);
  }
  const l3 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l3.setAttribute("x1", "3");
  l3.setAttribute("y1", "10");
  l3.setAttribute("x2", "21");
  l3.setAttribute("y2", "10");
  svg.appendChild(l3);

  return svg;
}

function renderEmptyQueue(): void {
  const queueTicketsList = $<HTMLElement>("#queue-tickets-list");
  if (!queueTicketsList) return;

  const btnManual = el("button", {
    id: "btn-queue-manual-empty",
    className: "btn-secondary btn-sm",
    style: { "margin-top": "1rem" },
    textContent: "Start Manual Run",
    onClick: openNewRunModal,
  });

  clearElement(queueTicketsList);
  queueTicketsList.appendChild(
    el("div", { className: "empty-state card" }, [
      el("div", { className: "empty-icon" }, [createEmptyQueueSvg()]),
      el("h3", { textContent: "No Work Items in Queue" }),
      el("p", {}, [
        "No open tickets with label ",
        el("code", { textContent: "agentic-workflow" }),
        " were found.",
      ]),
      btnManual,
    ]),
  );
}

function renderSearchEmptyQueue(query: string): void {
  const queueTicketsList = $<HTMLElement>("#queue-tickets-list");
  if (!queueTicketsList) return;

  const btnClear = el("button", {
    className: "btn-secondary btn-sm",
    style: { "margin-top": "1rem" },
    textContent: "Clear Filter",
    onClick: () => {
      const queueSearch = $<HTMLInputElement>("#queue-search");
      if (queueSearch) queueSearch.value = "";
      renderTicketsList(state.cachedTickets);
    },
  });

  clearElement(queueTicketsList);
  queueTicketsList.appendChild(
    el("div", { className: "empty-state card" }, [
      el("h3", { textContent: "No Matching Tickets" }),
      el("p", { className: "text-muted" }, [
        `No tickets found matching "`,
        el("strong", { textContent: query }),
        `".`,
      ]),
      btnClear,
    ]),
  );
}

export function renderTicketsList(tickets: Ticket[], query?: string): void {
  const queueTicketsList = $<HTMLElement>("#queue-tickets-list");
  if (!queueTicketsList) return;
  if (!tickets || tickets.length === 0) {
    if (query) {
      renderSearchEmptyQueue(query);
    } else {
      renderEmptyQueue();
    }
    return;
  }

  clearElement(queueTicketsList);
  for (const t of tickets) {
    queueTicketsList.appendChild(createTicketCard(t));
  }
}

function renderQueueError(msg: string): void {
  const queueTicketsList = $<HTMLElement>("#queue-tickets-list");
  if (!queueTicketsList) return;

  const selectProject = $<HTMLSelectElement>("#select-project");
  const projectId = selectProject?.value || state.projects[0]?.id;

  const buttons: HTMLElement[] = [
    el("button", {
      id: "btn-queue-retry",
      className: "btn-secondary btn-sm",
      textContent: "Retry",
      onClick: () => {
        void loadWorkQueue();
      },
    }),
  ];

  if (projectId) {
    buttons.push(
      el("a", {
        className: "btn-primary btn-sm",
        href: `#/projects/${encodeURIComponent(projectId)}`,
        style: { "text-decoration": "none" },
        textContent: "Configure Issue Tracker →",
      }),
    );
  }

  clearElement(queueTicketsList);
  queueTicketsList.appendChild(
    el("div", { className: "empty-state card" }, [
      el("h3", { textContent: "Unable to load tickets" }),
      el("p", {
        className: "error-message",
        style: { display: "inline-block", "margin-top": "0.5rem" },
        textContent: msg,
      }),
      el(
        "div",
        {
          style: {
            display: "flex",
            gap: "0.75rem",
            "justify-content": "center",
            "margin-top": "1rem",
            "flex-wrap": "wrap",
          },
        },
        buttons,
      ),
    ]),
  );
}

function applyFetchedTickets(tickets: unknown): void {
  state.cachedTickets = Array.isArray(tickets) ? (tickets as Ticket[]) : [];
  const queueSearch = $<HTMLInputElement>("#queue-search");
  const queueBadge = $<HTMLElement>("#queue-badge");

  if (queueSearch) {
    queueSearch.disabled = false;
    queueSearch.value = "";
  }
  renderTicketsList(state.cachedTickets);
  if (queueBadge) queueBadge.textContent = String(state.cachedTickets.length);
}

export async function loadWorkQueue(): Promise<void> {
  const queueTicketsList = $<HTMLElement>("#queue-tickets-list");
  const selectProject = $<HTMLSelectElement>("#select-project");
  const btnQueueRefresh = $<HTMLButtonElement>("#btn-queue-refresh");
  if (!queueTicketsList) return;
  const projectId = selectProject?.value || state.projects[0]?.id;
  if (!projectId) return;

  if (btnQueueRefresh) btnQueueRefresh.disabled = true;
  clearElement(queueTicketsList);
  queueTicketsList.appendChild(
    el("div", { className: "empty-state card" }, [
      el("p", { textContent: "Checking for agentic-workflow tickets…" }),
    ]),
  );

  try {
    const tickets = await api<Ticket[]>(
      "GET",
      `/projects/${projectId}/tickets`,
    );
    applyFetchedTickets(tickets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    renderQueueError(msg);
  } finally {
    if (btnQueueRefresh) btnQueueRefresh.disabled = false;
  }
}

export function initQueue(): void {
  const btnQueueRefresh = $<HTMLButtonElement>("#btn-queue-refresh");
  if (btnQueueRefresh) {
    btnQueueRefresh.addEventListener("click", () => {
      void loadWorkQueue();
    });
  }

  const queueSearch = $<HTMLInputElement>("#queue-search");
  if (queueSearch) {
    queueSearch.addEventListener("input", (e: Event) => {
      const q = (e.target as HTMLInputElement).value.toLowerCase().trim();
      if (!q) {
        renderTicketsList(state.cachedTickets);
        return;
      }
      const filtered = state.cachedTickets.filter((t) => {
        const matchTitle = (t.title || "").toLowerCase().includes(q);
        const matchId = (t.id || "").toLowerCase().includes(q);
        const matchCriteria = (t.acceptanceCriteria || []).some((c) =>
          c.toLowerCase().includes(q),
        );
        return matchTitle || matchId || matchCriteria;
      });
      renderTicketsList(filtered, q);
    });
  }
}
