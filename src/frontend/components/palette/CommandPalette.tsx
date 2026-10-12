// src/frontend/components/palette/CommandPalette.tsx — Command palette: Mod+K and the toolbar Search button (#254).
//
// Built on the Dialog primitive (#250): focus is contained, the page is inert and
// Escape closes it. The list is a single-select listbox driven by the arrow keys
// and Return. Its data loads only while it is open.

import "./CommandPalette.css";

import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useModal } from "../../context/ModalContext.js";
import { useProjects, useRuns } from "../../hooks/useQueries.js";
import { isMacPlatform, shortcutLabel } from "../../shortcuts/registry.js";
import { Dialog } from "../overlays/Dialog.js";
import {
  buildPaletteItems,
  filterPaletteItems,
  type PaletteGroup,
  type PaletteItem,
} from "./palette-items.js";

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  /** True on a run page where the run can be stopped. */
  stopRunAvailable: boolean;
  onStopRun: () => void;
  onOpenShortcuts: () => void;
  /** Switches Light ⇄ Dark: the theme toggle's new home (SYS-10). */
  onToggleAppearance: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  return (
    <Dialog
      isOpen={props.isOpen}
      onClose={props.onClose}
      ariaLabel="Command palette"
      className="command-palette-content"
      overlayClassName="command-palette-overlay"
    >
      {props.isOpen ? <PaletteBody {...props} /> : null}
    </Dialog>
  );
}

function PaletteBody({
  onClose,
  stopRunAvailable,
  onStopRun,
  onOpenShortcuts,
  onToggleAppearance,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const { openNewRunModal, openOnboardingModal } = useModal();
  const isMac = isMacPlatform();
  const { data: projects = [] } = useProjects();
  const { data: runs = [] } = useRuns();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Focus is set after mount rather than with the autoFocus attribute, which
  // React applies during commit and which the test DOM reports as an error.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo(
    () =>
      filterPaletteItems(
        buildPaletteItems({
          projects,
          runs: runs.slice(0, 200),
          stopRunAvailable,
        }),
        query,
      ),
    [projects, runs, stopRunAvailable, query],
  );

  const activate = (item: PaletteItem) => {
    onClose();
    if (item.target?.kind === "route") {
      navigate(item.target.path);
    } else if (item.target?.kind === "external") {
      window.open(item.target.url, "_blank", "noopener,noreferrer");
    } else if (item.action === "start-run") {
      openNewRunModal();
    } else if (item.action === "add-project") {
      openOnboardingModal();
    } else if (item.action === "stop-run") {
      onStopRun();
    } else if (item.action === "shortcuts") {
      onOpenShortcuts();
    } else if (item.action === "toggle-appearance") {
      onToggleAppearance();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (items.length === 0 && event.key !== "Escape") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (event.key === "Enter") {
      const item = items[Math.min(activeIndex, items.length - 1)];
      if (!item) return;
      event.preventDefault();
      activate(item);
    }
  };

  const current = Math.min(activeIndex, Math.max(items.length - 1, 0));
  const optionId = (index: number) => `${listId}-option-${index}`;

  // The list keeps the build order (actions, sections, projects, runs, help) and
  // carries one header per group instead of the group word in every row (SYS-15).
  const groups = useMemo(() => {
    const order: PaletteGroup[] = [
      "Actions",
      "Sections",
      "Projects",
      "Runs",
      "Help",
    ];
    return order
      .map((name) => ({
        name,
        headerId: `${listId}-group-${name.toLowerCase()}`,
        entries: items
          .map((item, index) => ({ item, index }))
          .filter((entry) => entry.item.group === name),
      }))
      .filter((group) => group.entries.length > 0);
  }, [items, listId]);

  return (
    <div className="command-palette">
      <div className="command-palette-search">
        <svg className="icon icon-md" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-search" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            items.length > 0 ? optionId(current) : undefined
          }
          aria-label="Search sections, projects, runs and actions"
          placeholder="Search sections, projects, runs and actions"
          className="command-palette-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {items.length === 0 ? (
        <p className="command-palette-empty" role="status">
          No matches for “{query.trim()}”
        </p>
      ) : (
        <div id={listId} role="listbox" className="command-palette-list">
          {groups.map((group) => (
            <div
              key={group.name}
              role="group"
              aria-labelledby={group.headerId}
              className="command-palette-group"
            >
              <div id={group.headerId} className="command-palette-group-header">
                {group.name}
              </div>
              {group.entries.map(({ item, index }) => (
                <div
                  key={item.id}
                  id={optionId(index)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === current}
                  className={`command-palette-option${index === current ? " is-active" : ""}`}
                  data-group={item.group}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => activate(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") activate(item);
                  }}
                >
                  <span className="command-palette-label">{item.label}</span>
                  {item.detail ? (
                    <span className="command-palette-detail">
                      {item.detail}
                    </span>
                  ) : null}
                  {item.shortcutId && shortcutLabel(item.shortcutId, isMac) ? (
                    <kbd className="command-palette-keys">
                      {shortcutLabel(item.shortcutId, isMac)}
                    </kbd>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
