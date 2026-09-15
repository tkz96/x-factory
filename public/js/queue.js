// fallow-ignore-file coverage-gaps
// public/js/queue.js — Work item queue, ticket cards, instant search, and run pre-fill.

import { openNewRunModal } from "./router.js";
import { state } from "./state.js";
import { $, api, escapeHtml } from "./utils.js";

let onSelectTicketCallback = null;

export function setOnSelectTicket(fn) {
  onSelectTicketCallback = fn;
}

function handleSelectTicket(ticket) {
  const inputTicketId = $("#input-ticket-id");
  const inputTicketTitle = $("#input-ticket-title");
  const inputBranch = $("#input-branch");
  const inputCriteria = $("#input-criteria");
  const inputPlan = $("#input-plan");

  if (inputTicketId) inputTicketId.value = ticket.id;
  if (inputTicketTitle) inputTicketTitle.value = ticket.title;
  if (inputBranch) inputBranch.value = "";
  if (inputCriteria)
    inputCriteria.value = (ticket.acceptanceCriteria || []).join("\n");
  if (inputPlan && !inputPlan.value) {
    inputPlan.value = `1. Understand ticket requirements\n2. Implement changes for ${ticket.title}\n3. Verify test suite passes without regressions\n4. Review and deliver`;
  }

  if (onSelectTicketCallback) {
    onSelectTicketCallback(ticket);
  }
  openNewRunModal();
}

function createTicketCard(t) {
  const card = document.createElement("div");
  card.className = "ticket-card";

  const criteriaList = (t.acceptanceCriteria || [])
    .slice(0, 3)
    .map((c) => `<li>${escapeHtml(c)}</li>`)
    .join("");

  const extUrl = t.url
    ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" class="text-muted" style="font-size:0.75rem;" onclick="event.stopPropagation()">View on ${escapeHtml(t.provider)} ↗</a>`
    : "";

  card.innerHTML = `
    <div class="ticket-card-header">
      <div class="ticket-badges">
        <span class="ticket-key">${escapeHtml(t.id)}</span>
        <span class="ticket-provider">${escapeHtml(t.provider)}</span>
      </div>
      <button class="btn-primary btn-sm btn-start-ticket" data-id="${escapeHtml(t.id)}">Start Run</button>
    </div>
    <h3 class="ticket-title">${escapeHtml(t.title)}</h3>
    ${criteriaList ? `<ul class="ticket-criteria">${criteriaList}</ul>` : ""}
    <div class="ticket-footer">
      <div class="ticket-tags">
        <span class="filter-pill" style="font-size:0.7rem; padding:0.2rem 0.5rem;">
          <span class="pill-dot"></span>agentic-workflow
        </span>
      </div>
      ${extUrl}
    </div>
  `;

  card.addEventListener("click", () => handleSelectTicket(t));
  const btnStartTicket = card.querySelector(".btn-start-ticket");
  if (btnStartTicket) {
    btnStartTicket.addEventListener("click", (e) => {
      e.stopPropagation();
      handleSelectTicket(t);
    });
  }
  return card;
}

function renderEmptyQueue() {
  const queueTicketsList = $("#queue-tickets-list");
  if (!queueTicketsList) return;
  queueTicketsList.innerHTML = `
    <div class="empty-state card">
      <div class="empty-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
      <h3>No Work Items in Queue</h3>
      <p>No open tickets with label <code>agentic-workflow</code> were found.</p>
      <button id="btn-queue-manual-empty" class="btn-secondary btn-sm" style="margin-top: 1rem;">Start Manual Run</button>
    </div>
  `;
  const btnManual = $("#btn-queue-manual-empty");
  if (btnManual) btnManual.addEventListener("click", openNewRunModal);
}

function renderTicketsList(tickets) {
  const queueTicketsList = $("#queue-tickets-list");
  if (!queueTicketsList) return;
  if (!tickets || tickets.length === 0) {
    renderEmptyQueue();
    return;
  }

  queueTicketsList.innerHTML = "";
  for (const t of tickets) {
    queueTicketsList.appendChild(createTicketCard(t));
  }
}

function renderQueueError(msg) {
  const queueTicketsList = $("#queue-tickets-list");
  if (!queueTicketsList) return;
  queueTicketsList.innerHTML = `
    <div class="empty-state card">
      <h3>Unable to load tickets</h3>
      <p class="error-message" style="display:inline-block; margin-top:0.5rem;">${escapeHtml(msg)}</p>
      <button id="btn-queue-retry" class="btn-secondary btn-sm" style="margin-top: 1rem;">Retry</button>
    </div>
  `;
  const btnRetry = $("#btn-queue-retry");
  if (btnRetry) btnRetry.addEventListener("click", loadWorkQueue);
}

function applyFetchedTickets(tickets) {
  state.cachedTickets = Array.isArray(tickets) ? tickets : [];
  const queueSearch = $("#queue-search");
  const queueBadge = $("#queue-badge");

  if (queueSearch) {
    queueSearch.disabled = false;
    queueSearch.value = "";
  }
  renderTicketsList(state.cachedTickets);
  if (queueBadge) queueBadge.textContent = state.cachedTickets.length;
}

export async function loadWorkQueue() {
  const queueTicketsList = $("#queue-tickets-list");
  const selectProject = $("#select-project");
  if (!queueTicketsList) return;
  const projectId = selectProject?.value || state.projects[0]?.id;
  if (!projectId) return;

  queueTicketsList.innerHTML =
    '<div class="empty-state card"><p>Checking for agentic-workflow tickets…</p></div>';

  try {
    const tickets = await api("GET", `/projects/${projectId}/tickets`);
    applyFetchedTickets(tickets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    renderQueueError(msg);
  }
}

export function initQueue() {
  const queueSearch = $("#queue-search");
  if (queueSearch) {
    queueSearch.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
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
      renderTicketsList(filtered);
    });
  }
}
