// src/frontend/views/NotFoundView.tsx — The not-found screen (S-12).
//
// An address no screen claims says so where the user is, instead of silently
// redirecting: the "content unavailable" empty state — a glyph, the headline,
// one footnote line and the one action back into the app.

import "./NotFoundView.css";

import { Link } from "react-router-dom";
import { NOT_FOUND_COPY } from "../components/feedback/copy-map.js";

export function NotFoundView() {
  return (
    <section id="area-not-found" className="area-view active">
      <div className="not-found">
        <svg className="icon icon-xl not-found-glyph" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-info" />
        </svg>
        <h2 className="not-found-title">{NOT_FOUND_COPY.headline}</h2>
        <p className="not-found-hint">{NOT_FOUND_COPY.hint}</p>
        <Link className="ui-button ui-button--secondary" to="/tickets">
          {NOT_FOUND_COPY.action}
        </Link>
      </div>
    </section>
  );
}
