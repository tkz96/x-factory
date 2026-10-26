// src/frontend/components/ui/Icon.tsx — The one way to draw a sprite glyph (spec #292).
//
// Every icon comes from the bundled sprite and is drawn through this block, so
// stroke, size and alignment stay the same everywhere. Outside components/ui/
// nothing names the sprite path directly (gate G6). An icon is decorative unless
// it is given a label; a labelled icon is announced as an image.

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface IconProps {
  /** Sprite symbol id, for example "icon-check". */
  name: string;
  size?: IconSize;
  /** Announced name. Leave it out when text next to the icon says the same. */
  label?: string;
  className?: string | undefined;
}

export function Icon({ name, size = "md", label, className }: IconProps) {
  const classes = ["icon", `icon-${size}`];
  if (className !== undefined) classes.push(className);
  const glyph = <use href={`/assets/icons/sprite.svg#${name}`} />;
  if (label === undefined) {
    return (
      <svg className={classes.join(" ")} aria-hidden="true">
        {glyph}
      </svg>
    );
  }
  return (
    <svg className={classes.join(" ")} role="img">
      <title>{label}</title>
      {glyph}
    </svg>
  );
}
