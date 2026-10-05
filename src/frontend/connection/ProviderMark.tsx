// src/frontend/connection/ProviderMark.tsx — Provider badge mark icon (spec #126, #130).

import "./ProviderMark.css";

interface ProviderMarkProps {
  providerId: string | null;
  size?: "sm" | "md" | "lg";
}

export function ProviderMark({ providerId, size = "md" }: ProviderMarkProps) {
  const initial = providerId ? providerId.charAt(0).toUpperCase() : "?";

  return (
    <span
      role="img"
      className={`provider-mark provider-mark-${size}`}
      aria-label={providerId ?? "Unknown provider"}
    >
      {initial}
    </span>
  );
}
