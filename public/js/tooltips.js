// fallow-ignore-file coverage-gaps
// public/js/tooltips.js — Interactive tooltip collision detection, popover repositioning, and event listeners.

function repositionTooltip(badge) {
  const popover = badge?.querySelector(".tooltip-popover");
  if (!popover) return;
  const badgeRect = badge.getBoundingClientRect();
  const container = badge.closest(".modal-body") || document.documentElement;
  const contRect = container.getBoundingClientRect();

  // Check horizontal space
  const spaceOnRight = contRect.right - badgeRect.left;
  if (spaceOnRight < 320) {
    popover.classList.add("popover-align-right");
  } else {
    popover.classList.remove("popover-align-right");
  }

  // Check vertical space
  const spaceBelow = contRect.bottom - badgeRect.bottom;
  const popoverHeight = popover.offsetHeight || 160;
  if (spaceBelow < popoverHeight + 16 && badgeRect.top - contRect.top > popoverHeight) {
    popover.classList.add("popover-flipped");
  } else {
    popover.classList.remove("popover-flipped");
  }
}

function handleTooltipOpen(e) {
  const badge = e.target?.closest?.(".tooltip-badge");
  if (badge) {
    repositionTooltip(badge);
    badge.closest(".form-group")?.classList.add("tooltip-open");
    badge.closest(".label-with-tooltip")?.classList.add("tooltip-open");
  }
}

function handleTooltipClose(e) {
  const badge = e.target?.closest?.(".tooltip-badge");
  if (badge) {
    badge.closest(".form-group")?.classList.remove("tooltip-open");
    badge.closest(".label-with-tooltip")?.classList.remove("tooltip-open");
  }
}

export function initTooltips() {
  document.addEventListener("pointerenter", handleTooltipOpen, true);
  document.addEventListener("focusin", handleTooltipOpen, true);
  document.addEventListener("pointerleave", handleTooltipClose, true);
  document.addEventListener("focusout", handleTooltipClose, true);
}
