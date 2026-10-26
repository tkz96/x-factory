// src/frontend/connection/ProviderMark.tsx — Provider badge mark icon (spec #126, #130).

import { Icon } from "../components/ui/Icon.js";
import "./ProviderMark.css";

interface ProviderMarkProps {
  providerId: string | null;
  iconRef?: string | null | undefined;
  displayName?: string | null | undefined;
  size?: "sm" | "md" | "lg";
}

function resolveSpriteId(iconRef?: string | null | undefined): string | null {
  if (!iconRef) return null;
  const stripped = iconRef.replace(/^(provider-|icon-)/, "");
  if (!/^[a-z0-9-]+$/.test(stripped)) {
    return null;
  }
  return `icon-${stripped}`;
}

export function ProviderMark({
  providerId,
  iconRef,
  displayName,
  size = "md",
}: ProviderMarkProps) {
  const initial = (displayName || providerId || "?").charAt(0).toUpperCase();
  const label = displayName || providerId || "Unknown provider";
  const spriteId = resolveSpriteId(iconRef);

  return (
    <span
      role="img"
      /* The mark's letter takes the badge-sized .text-caption-1 style. */
      className={`provider-mark provider-mark-${size} text-caption-1 font-semibold`}
      aria-label={label}
    >
      {spriteId ? <Icon name={spriteId} size={size} /> : initial}
    </span>
  );
}
