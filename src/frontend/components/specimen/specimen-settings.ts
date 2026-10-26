// The specimen's switch state. Kept apart from the page so the switch and page
// modules do not import each other.

export interface SpecimenSettings {
  theme: "default" | "graphite" | "sandstone";
  appearance: "light" | "dark";
  contrast: "standard" | "more";
  transparency: "automatic" | "reduced" | "full";
  readableFont: boolean;
}
