// src/frontend/components/ui/aria-props.ts — The React Aria boundary helper.
//
// React Aria marks optional props as `?: T` without `undefined`, and this
// project compiles with `exactOptionalPropertyTypes`, so an explicitly
// `undefined` value is a type error there. Dropping undefined-valued keys is
// exactly what omitting them means to React, so every block sanitises its
// pass-through props here instead of threading conditionals through its JSX.

export function withoutUndefined<T extends object>(
  props: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const defined: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) defined[key] = value;
  }
  return defined as { [K in keyof T]?: Exclude<T[K], undefined> };
}
