// The specimen's control blocks: every block in components/ui/, in its variants.

import { useState } from "react";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";
import { ListGroup, ListGroupRow } from "../ui/ListGroup.js";
import { ListRow, PlaceholderRows } from "../ui/ListRow.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";
import { SelectField } from "../ui/SelectField.js";
import { Spinner } from "../ui/Spinner.js";
import { SwitchControl } from "../ui/SwitchControl.js";
import { Table, TableCell, TableRow } from "../ui/Table.js";
import { TextAreaField, TextField } from "../ui/TextField.js";

const VARIANTS = ["primary", "secondary", "danger", "quiet"] as const;
const SIZES = ["sm", "md", "lg"] as const;
const TONES = ["neutral", "accent", "success", "warning", "error"] as const;

export function SpecimenBlocks() {
  const [segment, setSegment] = useState("all");
  const [option, setOption] = useState("runs");
  const [enabled, setEnabled] = useState(true);
  return (
    <section className="specimen-section" aria-labelledby="specimen-blocks">
      <h2 id="specimen-blocks" className="specimen-heading">
        Blocks
      </h2>

      <h3 className="specimen-subheading">Button</h3>
      <div className="specimen-row">
        {VARIANTS.map((variant) =>
          SIZES.map((size) => (
            <Button key={`${variant}-${size}`} variant={variant} size={size}>
              {variant} {size}
            </Button>
          )),
        )}
        <Button variant="primary" icon="icon-plus">
          With icon
        </Button>
        <Button variant="primary" isDisabled>
          Disabled
        </Button>
      </div>

      <h3 className="specimen-subheading">IconButton</h3>
      <div className="specimen-row">
        <IconButton label="Search" icon="icon-search" variant="filled" />
        <IconButton label="Settings" icon="icon-settings" variant="plain" />
        <IconButton label="Notifications" icon="icon-bell" variant="filled">
          <span className="specimen-count">3</span>
        </IconButton>
      </div>

      <h3 className="specimen-subheading">Badge</h3>
      <div className="specimen-row">
        {TONES.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
        <Badge variant="id">DEMO-101</Badge>
      </div>

      <h3 className="specimen-subheading">Segmented control, select, switch</h3>
      <div className="specimen-row">
        <SegmentedControl
          label="Filter"
          value={segment}
          onChange={setSegment}
          options={[
            { id: "all", label: "All", count: 6 },
            { id: "active", label: "Active", count: 2 },
            { id: "done", label: "Done" },
          ]}
        />
        <SelectField
          label="Project"
          value={option}
          onChange={(id) => setOption(String(id))}
          options={[
            { id: "runs", label: "Runs" },
            { id: "tickets", label: "Tickets" },
          ]}
        />
        <SwitchControl
          label="Notify me"
          isSelected={enabled}
          onChange={setEnabled}
        />
      </div>

      <h3 className="specimen-subheading">Text field</h3>
      <div className="specimen-fields">
        <TextField
          label="Repository"
          description="owner/name"
          placeholder="acme/web"
        />
        <TextAreaField label="Notes" placeholder="Describe the change" />
      </div>

      <h3 className="specimen-subheading">List group</h3>
      <div className="specimen-lists">
        <ListGroup title="Connections" footer="Each connection is one account.">
          <ListGroupRow title="GitHub" subtitle="Connected" href="/settings" />
          <ListGroupRow title="Jira" subtitle="Not connected" />
        </ListGroup>
        <ListGroup title="Plain rows">
          <ListRow
            title="Open the run"
            subtitle="Ticket DEMO-101"
            trailing={<Badge tone="accent">Running</Badge>}
          />
          <ListRow title="Read-only row" subtitle="No action" />
        </ListGroup>
        <PlaceholderRows count={2} group />
      </div>

      <h3 className="specimen-subheading">Table</h3>
      <Table
        label="Runs"
        columns={[
          { id: "id", label: "Ticket" },
          { id: "status", label: "Status" },
          { id: "age", label: "Age", align: "end", sortable: true },
        ]}
      >
        <TableRow>
          <TableCell isRowHeader>DEMO-101</TableCell>
          <TableCell>Running</TableCell>
          <TableCell numeric>2m</TableCell>
        </TableRow>
        <TableRow isHighlighted>
          <TableCell isRowHeader>DEMO-102</TableCell>
          <TableCell>Needs review</TableCell>
          <TableCell numeric>14m</TableCell>
        </TableRow>
      </Table>

      <h3 className="specimen-subheading">Spinner</h3>
      <div className="specimen-row">
        <Spinner />
      </div>
    </section>
  );
}
