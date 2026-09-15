// fallow-ignore-file coverage-gaps
// public/js/tooltips.js — Interactive tooltip collision detection, popover repositioning, and event listeners.

function repositionTooltip(badge) {
  const popover = badge?.querySelector(".tooltip-popover");
  if (!popover) return;
  const badgeRect = badge.getBoundingClientRect();
  const container =
    badge.closest(".inspection-cards-list") ||
    badge.closest(".modal-body") ||
    document.documentElement;
  const contRect = container.getBoundingClientRect();

  // Check horizontal space: only align right if right side is constrained AND left side has room
  const spaceOnRight = contRect.right - badgeRect.left;
  const spaceOnLeft = badgeRect.right - contRect.left;
  if (spaceOnRight < 310 && spaceOnLeft >= 280) {
    popover.classList.add("popover-align-right");
  } else {
    popover.classList.remove("popover-align-right");
  }

  // Check vertical space: flip up if bottom is cramped and space above is greater than space below
  const spaceBelow = contRect.bottom - badgeRect.bottom;
  const spaceAbove = badgeRect.top - contRect.top;
  const popoverHeight = popover.offsetHeight || 140;

  if (spaceBelow < popoverHeight + 16 && spaceAbove >= spaceBelow) {
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

  // Close or reposition tooltips when scrolling inside scrollable containers
  document.addEventListener(
    "scroll",
    (_e) => {
      const activeBadge = document.querySelector(
        ".tooltip-open .tooltip-badge",
      );
      if (activeBadge) {
        repositionTooltip(activeBadge);
      }
    },
    true,
  );
}
