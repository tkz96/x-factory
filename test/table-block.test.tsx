// test/table-block.test.tsx — the Table block (UI round 2): sortable headers
// cycle ascending → descending, report aria-sort, and a detail row spans the
// table.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import {
  Table,
  TableCell,
  TableDetailRow,
  TableRow,
  type TableSort,
} from "../src/frontend/components/ui/Table.js";

afterEach(() => cleanup());
afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

function Sortable() {
  const [sort, setSort] = useState<TableSort>({
    column: "name",
    direction: "ascending",
  });
  return (
    <Table
      label="Things"
      sort={sort}
      onSortChange={setSort}
      columns={[
        { id: "name", label: "Name", sortable: true },
        { id: "size", label: "Size", align: "end", sortable: true },
        { id: "action", label: "Action", hideLabel: true },
      ]}
    >
      <TableRow isHighlighted>
        <TableCell isRowHeader>alpha</TableCell>
        <TableCell numeric label="Size">
          3
        </TableCell>
        <TableCell align="end">x</TableCell>
      </TableRow>
      <TableDetailRow span={3} id="detail-alpha">
        <p>more</p>
      </TableDetailRow>
    </Table>
  );
}

const header = (name: string) =>
  Array.from(document.querySelectorAll("th[scope='col']")).find((th) =>
    (th.textContent ?? "").includes(name),
  ) as HTMLElement;

describe("Table block", () => {
  it("cycles a sorted column and moves the sort to another column", () => {
    render(<Sortable />);
    expect(header("Name").getAttribute("aria-sort")).toBe("ascending");
    expect(header("Size").getAttribute("aria-sort")).toBe("none");
    fireEvent.click(header("Name").querySelector("button") as HTMLElement);
    expect(header("Name").getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(header("Size").querySelector("button") as HTMLElement);
    expect(header("Size").getAttribute("aria-sort")).toBe("ascending");
    expect(header("Name").getAttribute("aria-sort")).toBe("none");
  });

  it("names the table, hides an action header's label, and spans a detail row", () => {
    render(<Sortable />);
    expect(document.querySelector("table")?.getAttribute("aria-label")).toBe(
      "Things",
    );
    expect(header("Action").querySelector(".sr-only")).not.toBeNull();
    expect(header("Action").hasAttribute("aria-sort")).toBe(false);
    const detail = document.getElementById("detail-alpha");
    expect(detail?.querySelector("td")?.getAttribute("colspan")).toBe("3");
    expect(document.querySelector("th[scope='row']")?.textContent).toBe(
      "alpha",
    );
    expect(
      document
        .querySelector(".ui-table-cell--numeric")
        ?.getAttribute("data-label"),
    ).toBe("Size");
    expect(document.querySelector(".ui-table-row--highlighted")).not.toBeNull();
  });
});
