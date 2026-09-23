// src/frontend/components/docs/DocsSidebarNav.tsx — Apple HIG documentation sidebar navigation.

import "./DocsSidebarNav.css";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import {
  api,
  type DocCategory,
  type DocSearchResult,
} from "../../lib/api-client.js";

const SECURITY_ITEMS = [
  { id: "least-privilege", label: "Least Privilege" },
  { id: "azure", label: "Azure DevOps" },
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
  { id: "jira", label: "Jira Software" },
] as const;

interface DocsSidebarNavProps {
  onToggleTheme: () => void;
  ThemeToggleButton: React.ComponentType<{
    id: string;
    className: string;
    onToggle: () => void;
  }>;
}

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

export function DocsSidebarNav({
  onToggleTheme,
  ThemeToggleButton,
}: DocsSidebarNavProps) {
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
  const { data: catalogData, isLoading: isCatalogLoading } = useQuery({
    queryKey: ["docs-catalog"],
    queryFn: () => api.getDocsCatalog(),
    staleTime: 60_000,
  });

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

  const handleSelectDoc = (category: string, slug: string) => {
    setSearchParams({ cat: category, slug });
    window.location.hash = "";
    const readingPane = document.getElementById("app-main");
    if (readingPane) {
      readingPane.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleSelectSecurity = (slug: string) => {
    setSearchParams({ cat: "security", slug });
    window.location.hash = "";
    const readingPane = document.getElementById("app-main");
    if (readingPane) {
      readingPane.scrollTo({ top: 0, behavior: "smooth" });
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
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else {
      window.location.hash = "";
      const readingPane = document.getElementById("app-main");
      if (readingPane) {
        readingPane.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  return (
    <>
      <div className="sidebar-header">
        <div className="docs-sidebar-brand">
          <span className="brand-title">X-Factory Docs</span>
        </div>

        <div className="docs-search-wrapper">
          <label htmlFor="docs-search-input" className="docs-search-label">
            Search Documentation (press /)
          </label>
          <div className="docs-search-field">
            <svg className="icon icon-sm docs-search-icon" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-search" />
            </svg>
            <input
              id="docs-search-input"
              ref={searchInputRef}
              type="text"
              placeholder="Search guides…"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              className="docs-search-input"
              aria-label="Search documentation"
            />
            <div className="docs-search-controls">
              {(isFiltering || isSearching) && (
                <div
                  className="docs-search-spinner"
                  role="status"
                  title="Searching documentation…"
                  aria-label="Searching documentation"
                />
              )}
              {rawQuery && (
                <button
                  type="button"
                  className="docs-search-clear-btn"
                  onClick={handleClearSearch}
                  title="Clear search (Esc)"
                  aria-label="Clear search query"
                >
                  <svg className="icon icon-sm" aria-hidden="true">
                    <use href="/assets/icons/sprite.svg#icon-x" />
                  </svg>
                </button>
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
              <span className="docs-search-summary-text">
                {isSearching
                  ? "Searching index…"
                  : `${searchData?.totalMatches ?? 0} ${(searchData?.totalMatches ?? 0) === 1 ? "match" : "matches"} found`}
              </span>
              <button
                type="button"
                className="docs-search-summary-clear"
                onClick={handleClearSearch}
                title="Clear search"
              >
                Clear
              </button>
            </div>

            {!isSearching && searchData?.results.length === 0 ? (
              <div className="docs-search-empty">
                <svg
                  className="icon icon-md docs-search-empty-icon"
                  aria-hidden="true"
                >
                  <use href="/assets/icons/sprite.svg#icon-search" />
                </svg>
                <span className="docs-search-empty-title">
                  No matches for &ldquo;{trimmedSearchQuery}&rdquo;
                </span>
                <p className="docs-search-empty-desc">
                  Try searching for keywords like &ldquo;PRAGMA&rdquo;,
                  &ldquo;lease&rdquo;, &ldquo;implementing&rdquo;, or
                  &ldquo;azure&rdquo;.
                </p>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={handleClearSearch}
                >
                  Reset search
                </button>
              </div>
            ) : (
              <div className="docs-search-results-list">
                {searchData?.results.map((result: DocSearchResult) => {
                  const isCurrentDoc =
                    activeCategory === result.category &&
                    activeSlug === result.slug;
                  return (
                    <div
                      key={`${result.category}-${result.slug}`}
                      className="docs-search-group"
                    >
                      <button
                        type="button"
                        className={`docs-search-group-header ${isCurrentDoc ? "active" : ""}`}
                        onClick={() =>
                          handleSelectDoc(result.category, result.slug)
                        }
                        title={result.title}
                      >
                        <div className="docs-search-group-meta">
                          <span className="docs-search-group-cat">
                            {result.categoryName}
                          </span>
                          <span className="docs-search-hit-badge">
                            {result.totalMatches}{" "}
                            {result.totalMatches === 1 ? "match" : "matches"}
                          </span>
                        </div>
                        <span className="docs-search-doc-title">
                          {result.title}
                        </span>
                      </button>

                      {result.sections.length > 0 && (
                        <div className="docs-search-sections">
                          {result.sections.map((sec) => (
                            <button
                              key={`${result.slug}-${sec.headingId || sec.heading}`}
                              type="button"
                              className="docs-search-section-item"
                              onClick={() =>
                                handleSelectSection(
                                  result.category,
                                  result.slug,
                                  sec.headingId,
                                )
                              }
                              title={`Jump to: ${sec.heading}`}
                            >
                              <div className="docs-search-section-header">
                                <svg
                                  className="icon icon-xs docs-search-section-bullet"
                                  aria-hidden="true"
                                >
                                  <use href="/assets/icons/sprite.svg#icon-arrow-right" />
                                </svg>
                                <span className="docs-search-section-title">
                                  {sec.heading}
                                </span>
                              </div>
                              {sec.snippet && (
                                <p className="docs-search-section-snippet">
                                  {renderSnippetWithHighlight(
                                    sec.snippet,
                                    trimmedSearchQuery,
                                  )}
                                </p>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : isCatalogLoading ? (
          <div className="docs-search-empty">
            <span>Loading documentation index…</span>
          </div>
        ) : (
          <>
            {categories.map((cat) => (
              <div key={cat.id} className="docs-nav-group">
                <div className="docs-category-title">
                  <svg className="icon icon-sm" aria-hidden="true">
                    {cat.id === "tutorials" && (
                      <use href="/assets/icons/sprite.svg#icon-play" />
                    )}
                    {cat.id === "how-to" && (
                      <use href="/assets/icons/sprite.svg#icon-refresh-cw" />
                    )}
                    {cat.id === "reference" && (
                      <use href="/assets/icons/sprite.svg#icon-code" />
                    )}
                    {cat.id === "explanation" && (
                      <use href="/assets/icons/sprite.svg#icon-info" />
                    )}
                  </svg>
                  <span>{cat.name}</span>
                </div>
                {cat.docs.map((doc) => {
                  const isSelected =
                    !isSecurity &&
                    activeCategory === cat.id &&
                    activeSlug === doc.slug;
                  return (
                    <button
                      key={doc.slug}
                      type="button"
                      onClick={() => handleSelectDoc(cat.id, doc.slug)}
                      className={`docs-nav-btn ${isSelected ? "active" : ""}`}
                      title={doc.title}
                    >
                      <span className="docs-nav-label">{doc.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}

            <div className="docs-nav-group">
              <div className="docs-category-title">
                <svg className="icon icon-sm" aria-hidden="true">
                  <use href="/assets/icons/sprite.svg#icon-lock" />
                </svg>
                <span>Credentials &amp; Scopes</span>
              </div>
              {SECURITY_ITEMS.map((sec) => {
                const isSelected = isSecurity && activeSlug === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => handleSelectSecurity(sec.id)}
                    className={`docs-nav-btn ${isSelected ? "active" : ""}`}
                    title={sec.label}
                  >
                    <span className="docs-nav-label">{sec.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <NavLink
          to="/queue"
          className="docs-back-link"
          title="Return to Factory Workbench"
        >
          <svg className="icon icon-sm" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-arrow-left" />
          </svg>
          <span>Back to Workbench</span>
        </NavLink>
        <ThemeToggleButton
          id="docs-theme-toggle"
          className="theme-toggle"
          onToggle={onToggleTheme}
        />
      </div>
    </>
  );
}
