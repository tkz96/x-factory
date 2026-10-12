// src/frontend/lib/format-money.ts — One way to write a dollar amount, for the
// run page's Models card and Settings › Models alike: two decimals at least
// ($0.00, $0.05), and two significant digits only when the amount is below a
// cent ($0.0047), so a tiny cost is not hidden as $0.00.

/** "$0.05", "$1,234.50", "$0.0047". */
export function formatUsd(usd: number): string {
  const amount = Number.isFinite(usd) ? usd : 0;
  const magnitude = Math.abs(amount);
  // Below a cent, show the decimals that reach the second significant digit.
  const fraction =
    magnitude > 0 && magnitude < 0.01
      ? Math.max(2, 1 - Math.floor(Math.log10(magnitude)))
      : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: fraction,
  }).format(amount);
}
