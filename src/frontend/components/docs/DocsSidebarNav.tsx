// src/frontend/components/docs/DocsSidebarNav.tsx — Apple HIG documentation sidebar navigation.

import "./DocsSidebarNav.css";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import type { DocCategory, DocSearchResult } from "../../../shared/types.js";
import { scrollBehavior } from "../../hooks/scroll-behavior.js";
import { api } from "../../lib/api-client.js";
import { AsyncRegion } from "../feedback/AsyncRegion.js";
import { deriveAsyncState } from "../feedback/derive-async-state.js";
import { Tooltip, TooltipTrigger } from "../overlays/Tooltip.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Icon } from "../ui/Icon.js";
import { IconButton } from "../ui/IconButton.js";
import { Spinner } from "../ui/Spinner.js";

/** The sprite glyph of each Diátaxis category in the document list. */
const CATEGORY_ICONS: Record<string, string> = {
  tutorials: "icon-play",
  "how-to": "icon-refresh-cw",
  reference: "icon-code",
  explanation: "icon-info",
};

const SECURITY_ITEMS = [
  { id: "least-privilege", label: "Least Privilege" },
  { id: "azure", label: "Azure DevOps" },
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
  { id: "jira", label: "Jira Software" },
] as const;

// The document list carries no theme toggle of its own: appearance
// belongs to Settings › General and the palette, and the header no longer holds
// one either.

interface SnippetSegment {
  key: string;
  text: string;
  isMatch: boolean;
}

function renderSnippetWithHighlight(
  snippet: string,
  query: string,
): React.ReactNode[] {
  if (!query.trim()) return [snippet];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = snippet.split(new RegExp(`(${escaped})`, "gi"));
  const segments: SnippetSegment[] = [];
  let offset = 0;
  for (const part of parts) {
    if (!part) continue;
    segments.push({
      key: `seg-${offset}-${part.length}`,
      text: part,
      isMatch: part.toLowerCase() === query.toLowerCase(),
    });
    offset += part.length;
  }

  return segments.map((seg) => {
    if (seg.isMatch) {
      return (
        <mark key={seg.key} className="docs-search-highlight">
          {seg.text}
        </mark>
      );
    }
    return <span key={seg.key}>{seg.text}</span>;
  });
}

export function DocsSidebarNav() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeCategory = searchParams.get("cat") || "tutorials";
  const activeSlug = searchParams.get("slug") || "first-agent-run";
  const isSecurity = activeCategory === "security";

  // Search state with debounced visual delay and motion
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isFiltering, setIsFiltering] = useState(false);

  useEffect(() => {
    if (rawQuery === debouncedQuery) {
      setIsFiltering(false);
      return;
    }
    setIsFiltering(true);
    const timer = setTimeout(() => {
      setDebouncedQuery(rawQuery);
      setIsFiltering(false);
    }, 180);
    return () => clearTimeout(timer);
  }, [rawQuery, debouncedQuery]);

  // Keyboard shortcut '/' to focus search, 'Escape' to clear
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 1. Fetch documentation catalog (for tree view)
  const catalogQuery = useQuery({
    queryKey: ["docs-catalog"],
    queryFn: () => api.getDocsCatalog(),
    staleTime: 60_000,
  });
  const { data: catalogData, isLoading: isCatalogLoading } = catalogQuery;

  const categories: DocCategory[] = catalogData?.categories || [];

  // 2. Full-text search query (active when query has at least 2 characters)
  const trimmedSearchQuery = debouncedQuery.trim();
  const isSearchActive = trimmedSearchQuery.length >= 2;

  const { data: searchData, isFetching: isSearching } = useQuery({
    queryKey: ["docs-search", trimmedSearchQuery],
    queryFn: () => api.searchDocs(trimmedSearchQuery),
    enabled: isSearchActive,
    staleTime: 30_000,
  });

  const handleClearSearch = () => {
    setRawQuery("");
    setDebouncedQuery("");
    searchInputRef.current?.focus();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setRawQuery("");
      setDebouncedQuery("");
      searchInputRef.current?.blur();
    }
  };

  // Switching documents replaces the reading pane's content, so the pane goes
  // to the top instantly: a smooth glide would animate a document that is no
  // longer on screen. Only an in-page heading (below) scrolls smoothly.
  const handleSelectDoc = (category: string, slug: string) => {
    setSearchParams({ cat: category, slug });
    window.location.hash = "";
    const readingPane = document.getElementById("app-main");
    if (readingPane) {
      readingPane.scrollTo({ top: 0, behavior: "auto" });
    }
  };

  const handleSelectSecurity = (slug: string) => {
    setSearchParams({ cat: "security", slug });
    window.location.hash = "";
    const readingPane = document.getElementById("app-main");
    if (readingPane) {
      readingPane.scrollTo({ top: 0, behavior: "auto" });
    }
  };

  const handleSelectSection = (
    category: string,
    slug: string,
    headingId: string,
  ) => {
    setSearchParams({ cat: category, slug });
    if (headingId) {
      window.location.hash = headingId;
      const el = document.getElementById(headingId);
      if (el) {
        el.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
      }
    } else {
      window.location.hash = "";
      const readingPane = document.getElementById("app-main");
      if (readingPane) {
        readingPane.scrollTo({ top: 0, behavior: "auto" });
      }
    }
  };

  return (
    <>
      <div className="sidebar-header">
        <div className="docs-sidebar-brand">
          <span className="brand-title text-headline">X-Factory Docs</span>
        </div>

        <div className="docs-search-wrapper">
          <label
            htmlFor="docs-search-input"
            className="docs-search-label text-subhead"
          >
            Search Documentation (press /)
          </label>
          <div className="docs-search-field">
            <Icon name="icon-search" size="sm" className="docs-search-icon" />
            <input
              id="docs-search-input"
              ref={searchInputRef}
              type="text"
              placeholder="Search guides…"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              className="docs-search-input text-callout"
              aria-label="Search documentation"
            />
            <div className="docs-search-controls">
              {(isFiltering || isSearching) && (
                <Spinner
                  label="Searching documentation…"
                  className="docs-search-spinner"
                />
              )}
              {rawQuery && (
                <TooltipTrigger delay={300}>
                  <IconButton
                    label="Clear Search Query"
                    icon="icon-x"
                    variant="plain"
                    onPress={handleClearSearch}
                  />
                  <Tooltip placement="bottom">Clear search (Esc)</Tooltip>
                </TooltipTrigger>
              )}
            </div>
          </div>
        </div>
      </div>

      <nav id="docs-sidebar-nav" className="sidebar-nav">
        {isSearchActive ? (
          /* ── Search Results View ───────────────────────────────────────── */
          <div className="docs-search-results-container">
            <div className="docs-search-summary-bar">
              <span className="docs-search-summary-text text-caption-1">
                {isSearching
                  ? "Searching index…"
                  : `${searchData?.totalMatches ?? 0} ${(searchData?.totalMatches ?? 0) === 1 ? "match" : "matches"} found`}
              </span>
              <Button
                variant="quiet"
                size="sm"
                onPress={handleClearSearch}
                title="Clear search"
              >
                Clear
              </Button>
            </div>

            {!isSearching && searchData?.results.length === 0 ? (
              <EmptyState
                icon="icon-search"
                title={`No matches for \u201c${trimmedSearchQuery}\u201d`}
                message={
                  "Try searching for keywords like \u201cPRAGMA\u201d, \u201clease\u201d, \u201cimplementing\u201d, or \u201cazure\u201d."
                }
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={handleClearSearch}
                  >
                    Reset Search
                  </Button>
                }
              />
            ) : (
              <div className="docs-search-results-list">
                {searchData?.results.map((result: DocSearchResult) => {
                  const isCurrentDoc =
                    activeCategory === result.category &&
                    activeSlug === result.slug;
                  return (
                    <Card
                      key={`${result.category}-${result.slug}`}
                      padding="none"
                      className="docs-search-group"
                    >
                      <Button
                        variant="quiet"
                        className={`docs-search-group-header ${isCurrentDoc ? "active" : ""}`}
                        onPress={() =>
                          handleSelectDoc(result.category, result.slug)
                        }
                        title={result.title}
                      >
                        <div className="docs-search-group-meta">
                          <span className="docs-search-group-cat text-footnote">
                            {result.categoryName}
                          </span>
                          <span className="docs-search-hit-badge text-caption-1">
                            {result.totalMatches}{" "}
                            {result.totalMatches === 1 ? "match" : "matches"}
                          </span>
                        </div>
                        <span className="docs-search-doc-title text-headline">
                          {result.title}
                        </span>
                      </Button>

                      {result.sections.length > 0 && (
                        <div className="docs-search-sections">
                          {result.sections.map((sec) => (
                            <Button
                              key={`${result.slug}-${sec.headingId || sec.heading}`}
                              variant="quiet"
                              className="docs-search-section-item"
                              onPress={() =>
                                handleSelectSection(
                                  result.category,
                                  result.slug,
                                  sec.headingId,
                                )
                              }
                              title={`Jump to: ${sec.heading}`}
                            >
                              <div className="docs-search-section-header">
                                <Icon
                                  name="icon-arrow-right"
                                  size="xs"
                                  className="docs-search-section-bullet"
                                />
                                <span className="docs-search-section-title text-footnote">
                                  {sec.heading}
                                </span>
                              </div>
                              {sec.snippet && (
                                <p className="docs-search-section-snippet text-subhead">
                                  {renderSnippetWithHighlight(
                                    sec.snippet,
                                    trimmedSearchQuery,
                                  )}
                                </p>
                              )}
                            </Button>
                          ))}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : isCatalogLoading ? (
          <AsyncRegion
            derived={deriveAsyncState({
              data: undefined,
              isPending: true,
              isError: false,
              error: null,
            })}
          />
        ) : (
          <>
            {categories.map((cat) => {
              const categoryIcon = CATEGORY_ICONS[cat.id];
              return (
                <div key={cat.id} className="docs-nav-group">
                  <div className="docs-category-title text-subhead">
                    {categoryIcon && <Icon name={categoryIcon} size="sm" />}
                    <span>{cat.name}</span>
                  </div>
                  {cat.docs.map((doc) => {
                    const isSelected =
                      !isSecurity &&
                      activeCategory === cat.id &&
                      activeSlug === doc.slug;
                    return (
                      <Button
                        key={doc.slug}
                        variant="quiet"
                        size="sm"
                        onPress={() => handleSelectDoc(cat.id, doc.slug)}
                        className="docs-nav-item"
                        {...(isSelected
                          ? { "aria-current": "page" as const }
                          : {})}
                        title={doc.title}
                      >
                        <span className="docs-nav-label text-subhead">
                          {doc.title}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              );
            })}

            <div className="docs-nav-group">
              <div className="docs-category-title text-subhead">
                <Icon name="icon-lock" size="sm" />
                <span>Credentials &amp; Scopes</span>
              </div>
              {SECURITY_ITEMS.map((sec) => {
                const isSelected = isSecurity && activeSlug === sec.id;
                return (
                  <Button
                    key={sec.id}
                    variant="quiet"
                    size="sm"
                    onPress={() => handleSelectSecurity(sec.id)}
                    className="docs-nav-item"
                    {...(isSelected ? { "aria-current": "page" as const } : {})}
                    title={sec.label}
                  >
                    <span className="docs-nav-label text-subhead">
                      {sec.label}
                    </span>
                  </Button>
                );
              })}
            </div>
          </>
        )}
      </nav>

      <div className="sidebar-footer text-subhead">
        <NavLink to="/tickets" className="docs-back-link" title="Go to Tickets">
          <Icon name="icon-arrow-left" size="sm" />
          <span>Back to Tickets</span>
        </NavLink>
      </div>
    </>
  );
}
