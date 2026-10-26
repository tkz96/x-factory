// src/frontend/components/settings/ModelConnectionsPanel.tsx — Settings ›
// Models: add a model connection, Check Connection, choose models from what
// the check found, and edit each model's details, limits and budget (#277).
// Keys are typed into a password field and never shown again: the API only
// ever returns their last four characters.

import "./ModelConnectionsPanel.css";

import { useMemo, useState } from "react";
import {
  type DiscoveredModel,
  MODEL_API_TYPES,
  type ModelApiType,
  type ModelBudget,
  type ModelConnectionView,
  type ModelListResult,
  type ModelRecord,
  type ModelRecordPatch,
} from "../../../shared/model-connection-types.js";
import {
  useModelConnectionMutations,
  useModelConnections,
} from "../../hooks/useModelConnections.js";
import { useSettings } from "../../hooks/useQueries.js";
import { formatUsd } from "../../lib/format-money.js";
import { AsyncRegion } from "../feedback/AsyncRegion.js";
import { MODEL_CONNECTIONS_COPY as COPY } from "../feedback/copy-map.js";
import { deriveAsyncState } from "../feedback/derive-async-state.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";
import { AlertDialog } from "../overlays/index.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { EmptyState } from "../ui/EmptyState.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";
import {
  Table,
  TableCell,
  type TableColumn,
  TableDetailRow,
  TableRow,
  type TableSort,
} from "../ui/Table.js";
import { TextField } from "../ui/TextField.js";

type Mutations = ReturnType<typeof useModelConnectionMutations>;

const DEFAULT_URLS: Partial<Record<ModelApiType, string>> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "https://api.anthropic.com",
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Connection form (add / edit) ──────────────────────────────────────────

function ConnectionForm({
  initial,
  mutations,
  onDone,
}: {
  initial?: ModelConnectionView | undefined;
  mutations: Mutations;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [apiType, setApiType] = useState<ModelApiType>(
    initial?.apiType ?? "openai-compatible",
  );
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const saving = initial ? mutations.update : mutations.create;

  const changeType = (next: ModelApiType) => {
    setApiType(next);
    const known = Object.values(DEFAULT_URLS);
    if (!baseUrl.trim() || known.includes(baseUrl)) {
      setBaseUrl(DEFAULT_URLS[next] ?? "");
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const key = apiKey.trim();
    // One payload for both paths: creating also sends the API type (#277).
    const fields = {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      ...(key ? { apiKey: key } : {}),
    };
    if (initial) {
      mutations.update.mutate(
        { id: initial.id, ...fields },
        { onSuccess: onDone },
      );
    } else {
      mutations.create.mutate({ ...fields, apiType }, { onSuccess: onDone });
    }
  };

  return (
    <form className="model-connection-form" onSubmit={submit} noValidate>
      <div className="model-connection-grid">
        <label className="model-field" htmlFor="model-connection-name">
          <span className="model-field-label text-subhead font-semibold">
            {COPY.name}
          </span>
          <input
            id="model-connection-name"
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="model-field" htmlFor="model-connection-type">
          <span className="model-field-label text-subhead font-semibold">
            {COPY.apiType}
          </span>
          <select
            id="model-connection-type"
            className="form-input"
            value={apiType}
            disabled={Boolean(initial)}
            onChange={(e) => changeType(e.target.value as ModelApiType)}
          >
            {MODEL_API_TYPES.map((type) => (
              <option key={type} value={type}>
                {COPY.apiTypes[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="model-field" htmlFor="model-connection-url">
          <span className="model-field-label text-subhead font-semibold">
            {COPY.baseUrl}
          </span>
          <input
            id="model-connection-url"
            className="form-input"
            value={baseUrl}
            placeholder="https://openrouter.ai/api/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label className="model-field" htmlFor="model-connection-key">
          <span className="model-field-label text-subhead font-semibold">
            {COPY.apiKey}
          </span>
          <input
            id="model-connection-key"
            className="form-input"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            placeholder={initial ? COPY.apiKeyKeep : ""}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
      </div>
      {saving.isError && (
        <FeedbackBanner tone="error" message={errorText(saving.error)} />
      )}
      <div className="model-actions">
        <Button variant="secondary" size="sm" onPress={onDone}>
          {COPY.cancel}
        </Button>
        <Button
          type="submit"
          id="btn-save-model-connection"
          variant="primary"
          size="sm"
          isDisabled={saving.isPending}
        >
          {COPY.save}
        </Button>
      </div>
    </form>
  );
}

// ─── One chosen model's details ────────────────────────────────────────────

const DETAIL_FIELDS = [
  "contextWindow",
  "maxOutputTokens",
  "inputPricePerMTok",
  "outputPricePerMTok",
] as const;
const LIMIT_FIELDS = ["rpm", "tpm", "rpd", "tpd"] as const;
type FormKey =
  | (typeof DETAIL_FIELDS)[number]
  | (typeof LIMIT_FIELDS)[number]
  | "budgetUsd"
  | "budgetRequests";
function initialValues(model: ModelRecord): Record<FormKey, string> {
  const text = (n: number | undefined) => (n === undefined ? "" : String(n));
  return {
    contextWindow: text(model.contextWindow),
    maxOutputTokens: text(model.maxOutputTokens),
    inputPricePerMTok: text(model.inputPricePerMTok),
    outputPricePerMTok: text(model.outputPricePerMTok),
    rpm: text(model.limits.rpm),
    tpm: text(model.limits.tpm),
    rpd: text(model.limits.rpd),
    tpd: text(model.limits.tpd),
    budgetUsd: text(model.budget.perDay.usd),
    budgetRequests: text(model.budget.perDay.requests),
  };
}

/** Blank → unset; anything else → a number (the server validates the range). */
function toNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

function toPatch(values: Record<FormKey, string>): ModelRecordPatch {
  const detail = (key: (typeof DETAIL_FIELDS)[number]) =>
    toNumber(values[key]) ?? null;
  const defined = <T extends object>(obj: T) =>
    Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== undefined),
    ) as T;
  return {
    contextWindow: detail("contextWindow"),
    maxOutputTokens: detail("maxOutputTokens"),
    inputPricePerMTok: detail("inputPricePerMTok"),
    outputPricePerMTok: detail("outputPricePerMTok"),
    limits: defined({
      rpm: toNumber(values.rpm),
      tpm: toNumber(values.tpm),
      rpd: toNumber(values.rpd),
      tpd: toNumber(values.tpd),
    }),
    budget: {
      perDay: defined({
        usd: toNumber(values.budgetUsd),
        requests: toNumber(values.budgetRequests),
      }),
    },
  };
}

function formatTodayUsage(
  usage: { usd: number; requests: number } | undefined,
  budget: ModelBudget,
): string {
  const usdUsed = usage?.usd ?? 0;
  const reqUsed = usage?.requests ?? 0;
  const costPart =
    budget.perDay.usd !== undefined
      ? `${formatUsd(usdUsed)} / ${formatUsd(budget.perDay.usd)}`
      : formatUsd(usdUsed);
  const reqPart =
    budget.perDay.requests !== undefined
      ? `${reqUsed} / ${budget.perDay.requests} reqs`
      : `${reqUsed} reqs`;
  return `${costPart} • ${reqPart}`;
}

const FIELD_GROUPS: ReadonlyArray<{
  title: string;
  keys: readonly FormKey[];
}> = [
  { title: COPY.groupDetails, keys: DETAIL_FIELDS },
  { title: COPY.groupRateLimits, keys: LIMIT_FIELDS },
  { title: COPY.groupBudget, keys: ["budgetUsd", "budgetRequests"] },
];

/** One chosen model's details, limits and budget, opened from its table row. */
function ModelDetailsForm({
  connectionId,
  model,
  mutations,
}: {
  connectionId: string;
  model: ModelRecord;
  mutations: Mutations;
}) {
  const [values, setValues] = useState(() => initialValues(model));
  const prefix = `model-${connectionId}-${model.modelId}`;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    mutations.updateModel.mutate({
      id: connectionId,
      modelId: model.modelId,
      patch: toPatch(values),
    });
  };

  return (
    <form className="model-details" onSubmit={save} noValidate>
      {FIELD_GROUPS.map((group) => (
        <fieldset key={group.title} className="model-details-group">
          {/* The group label's type comes from the .text-footnote style. */}
          <legend className="model-details-legend text-footnote font-semibold">
            {group.title}
          </legend>
          <div className="model-details-grid">
            {group.keys.map((key) => (
              <TextField
                key={key}
                label={COPY[key]}
                inputId={`${prefix}-${key}`}
                inputMode="decimal"
                value={values[key]}
                onChange={(value) =>
                  setValues((prev) => ({ ...prev, [key]: value }))
                }
              />
            ))}
          </div>
        </fieldset>
      ))}
      <div className="model-actions">
        <Button
          variant="secondary"
          size="sm"
          onPress={() =>
            mutations.removeModel.mutate({
              id: connectionId,
              modelId: model.modelId,
            })
          }
        >
          {COPY.removeModel}
        </Button>
        <Button
          type="submit"
          id={`btn-save-${prefix}`}
          variant="primary"
          size="sm"
          isDisabled={mutations.updateModel.isPending}
        >
          {COPY.saveModel}
        </Button>
      </div>
    </form>
  );
}

// ─── The models table ──────────────────────────────────────────────────────

/** "262K", "1M", "8,192" — a token count as a person reads it. */
export function formatTokens(n: number | undefined): string {
  if (n === undefined) return COPY.unknown;
  if (n >= 1_000_000) {
    return `${Number((n / 1_000_000).toFixed(1))}M`;
  }
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return n.toLocaleString("en-US");
}

/** "$0.20 / $0.80", "Free", or "—" when the catalog says nothing. */
export function formatPricePair(
  input: number | undefined,
  output: number | undefined,
): string {
  if (input === undefined && output === undefined) return COPY.unknown;
  if ((input ?? 0) === 0 && (output ?? 0) === 0) return COPY.free;
  const one = (n: number | undefined) =>
    n === undefined ? COPY.unknown : n === 0 ? COPY.free : formatUsd(n);
  return `${one(input)} / ${one(output)}`;
}

interface ModelRow {
  id: string;
  name: string;
  contextWindow: number | undefined;
  maxOutputTokens: number | undefined;
  inputPricePerMTok: number | undefined;
  outputPricePerMTok: number | undefined;
  record: ModelRecord | undefined;
}

/** Chosen models (with their edited details) plus every other model found. */
export function buildModelRows(
  found: readonly DiscoveredModel[],
  chosen: readonly ModelRecord[],
): ModelRow[] {
  const discovered = new Map(found.map((m) => [m.id, m]));
  const rows: ModelRow[] = chosen.map((record) => {
    const seen = discovered.get(record.modelId);
    return {
      id: record.modelId,
      name: record.name ?? seen?.name ?? record.modelId,
      contextWindow: record.contextWindow ?? seen?.contextWindow,
      maxOutputTokens: record.maxOutputTokens ?? seen?.maxOutputTokens,
      inputPricePerMTok: record.inputPricePerMTok ?? seen?.inputPricePerMTok,
      outputPricePerMTok: record.outputPricePerMTok ?? seen?.outputPricePerMTok,
      record,
    };
  });
  const chosenIds = new Set(chosen.map((m) => m.modelId));
  for (const model of found) {
    if (chosenIds.has(model.id)) continue;
    rows.push({
      id: model.id,
      name: model.name ?? model.id,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      inputPricePerMTok: model.inputPricePerMTok,
      outputPricePerMTok: model.outputPricePerMTok,
      record: undefined,
    });
  }
  return rows;
}

/** Chosen first, then by the sorted column (unknown values last). */
export function sortModelRows(rows: ModelRow[], sort: TableSort): ModelRow[] {
  const dir = sort.direction === "ascending" ? 1 : -1;
  const value = (row: ModelRow): number | string | undefined =>
    sort.column === "context"
      ? row.contextWindow
      : sort.column === "price"
        ? row.inputPricePerMTok
        : row.name.toLowerCase();
  return [...rows].sort((a, b) => {
    const chosenFirst =
      Number(b.record !== undefined) - Number(a.record !== undefined);
    if (chosenFirst !== 0) return chosenFirst;
    const va = value(a);
    const vb = value(b);
    if (va === undefined && vb === undefined) return 0;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
  });
}

const MODEL_COLUMNS: readonly TableColumn[] = [
  { id: "name", label: COPY.columnModel, sortable: true },
  { id: "context", label: COPY.columnContext, align: "end", sortable: true },
  { id: "maxOutput", label: COPY.columnMaxOutput, align: "end" },
  { id: "price", label: COPY.columnPrice, align: "end", sortable: true },
  { id: "role", label: COPY.columnRole },
  { id: "today", label: COPY.columnToday, align: "end" },
  { id: "action", label: COPY.columnAction, hideLabel: true },
];

function ModelsTable({
  connection,
  found,
  mutations,
}: {
  connection: ModelConnectionView;
  found: readonly DiscoveredModel[];
  mutations: Mutations;
}) {
  const id = connection.id;
  const { data: settings } = useSettings();
  const roles = settings?.roles ?? {};
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "chosen">("all");
  const [sort, setSort] = useState<TableSort>({
    column: "name",
    direction: "ascending",
  });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = buildModelRows(found, connection.models);
    const shown = all.filter(
      (row) =>
        (filter === "all" || row.record !== undefined) &&
        (needle === "" ||
          row.name.toLowerCase().includes(needle) ||
          row.id.toLowerCase().includes(needle)),
    );
    return sortModelRows(shown, sort);
  }, [found, connection.models, query, filter, sort]);

  const roleNames = (modelId: string): string[] =>
    (["builder", "reviewer"] as const)
      .filter(
        (role) =>
          roles[role]?.connectionId === id && roles[role]?.modelId === modelId,
      )
      .map((role) => (role === "builder" ? "Builder" : "Reviewer"));

  const toggle = (modelId: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });

  const total =
    found.length +
    connection.models.filter((m) => !found.some((f) => f.id === m.modelId))
      .length;

  return (
    <div className="model-table">
      <div className="model-table-tools">
        <p className="model-found-count text-footnote">
          {COPY.modelsFound(total)}
        </p>
        <TextField
          label={COPY.searchModels}
          className="model-table-search"
          inputType="search"
          placeholder={COPY.searchPlaceholder}
          value={query}
          onChange={setQuery}
        />
        <SegmentedControl
          label={COPY.filterLabel}
          value={filter}
          onChange={(value) => setFilter(value === "chosen" ? "chosen" : "all")}
          options={[
            { id: "all", label: COPY.filterAll },
            {
              id: "chosen",
              label: COPY.filterChosen,
              count: connection.models.length,
            },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        /* No models match the search or filter: the EmptyState block, used
           where no data load happens (spec #292 "Blocks"). */
        <EmptyState title={COPY.noMatches} headingLevel={4} />
      ) : (
        <Table
          label={COPY.modelsTable(connection.name)}
          columns={MODEL_COLUMNS}
          sort={sort}
          onSortChange={setSort}
        >
          {rows.flatMap((row) => {
            const chosen = row.record !== undefined;
            const isOpen = open.has(row.id);
            const detailId = `model-limits-${id}-${row.id}`;
            const cells = (
              <TableRow key={row.id} isHighlighted={chosen}>
                <TableCell isRowHeader>
                  <span className="model-table-name">{row.name}</span>
                  {row.name !== row.id && (
                    <code className="model-table-id text-footnote">
                      {row.id}
                    </code>
                  )}
                </TableCell>
                <TableCell numeric label={COPY.columnContext}>
                  {formatTokens(row.contextWindow)}
                </TableCell>
                <TableCell numeric label={COPY.columnMaxOutput}>
                  {formatTokens(row.maxOutputTokens)}
                </TableCell>
                <TableCell numeric label={COPY.columnPrice}>
                  {formatPricePair(
                    row.inputPricePerMTok,
                    row.outputPricePerMTok,
                  )}
                </TableCell>
                <TableCell>
                  {roleNames(row.id).map((role) => (
                    <Badge key={role} tone="accent">
                      {role}
                    </Badge>
                  ))}
                </TableCell>
                <TableCell numeric label={COPY.columnToday}>
                  {row.record !== undefined
                    ? formatTodayUsage(row.record.todayUsage, row.record.budget)
                    : COPY.unknown}
                </TableCell>
                <TableCell align="end">
                  {chosen ? (
                    <Button
                      id={`btn-edit-limits-${id}-${row.id}`}
                      variant="secondary"
                      size="sm"
                      aria-expanded={isOpen}
                      aria-controls={detailId}
                      aria-label={COPY.editLimitsLabel(row.name)}
                      onPress={() => toggle(row.id)}
                    >
                      {COPY.editLimits}
                    </Button>
                  ) : (
                    <Button
                      id={`btn-add-model-${id}-${row.id}`}
                      variant="secondary"
                      size="sm"
                      aria-label={COPY.addModelLabel(row.name)}
                      onPress={() =>
                        mutations.addModel.mutate({ id, modelId: row.id })
                      }
                    >
                      {COPY.addModel}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
            if (!chosen || !isOpen || row.record === undefined) return [cells];
            return [
              cells,
              <TableDetailRow
                key={`${row.id}-limits`}
                id={detailId}
                span={MODEL_COLUMNS.length}
              >
                <ModelDetailsForm
                  connectionId={id}
                  model={row.record}
                  mutations={mutations}
                />
              </TableDetailRow>,
            ];
          })}
        </Table>
      )}
    </div>
  );
}

// ─── One connection ────────────────────────────────────────────────────────

function ConnectionCard({
  connection,
  mutations,
}: {
  connection: ModelConnectionView;
  mutations: Mutations;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [checkResult, setCheckResult] = useState<ModelListResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const id = connection.id;
  // A fresh check wins; otherwise show what the last check found and the
  // server kept, so a reload does not hide the models still to be added.
  const found = checkResult?.ok
    ? checkResult.models
    : connection.availableModels;
  const checking =
    mutations.check.isPending && mutations.check.variables === id;

  const check = () => {
    setCheckError(null);
    mutations.check.mutate(id, {
      onSuccess: setCheckResult,
      onError: (err) => setCheckError(errorText(err)),
    });
  };

  if (editing) {
    return (
      <li>
        <Card variant="model">
          <ConnectionForm
            initial={connection}
            mutations={mutations}
            onDone={() => setEditing(false)}
          />
        </Card>
      </li>
    );
  }

  return (
    <li>
      {/* The model family of the Card block (#296): the quiet inset fill. */}
      <Card variant="model">
        <div className="model-connection-head">
          <div>
            {/* The name takes the .text-headline style; the meta lines, the
                .text-subhead style (spec #292 "Text styles"). */}
            <strong className="model-connection-name text-headline">
              {connection.name}
            </strong>
            <span className="model-connection-meta text-subhead">
              {COPY.apiTypes[connection.apiType]} · {connection.baseUrl}
            </span>
            <span className="model-connection-meta text-subhead">
              {connection.keyLast4
                ? COPY.keyMasked(connection.keyLast4)
                : COPY.noKey}
              {connection.keySource === "environment" &&
                ` (${COPY.fromEnvironment})`}
            </span>
          </div>
          <Badge tone={connection.verifiedAt ? "success" : "neutral"}>
            {connection.verifiedAt ? COPY.verified : COPY.notChecked}
          </Badge>
        </div>

        <div className="model-actions model-actions--start">
          <Button
            id={`btn-check-model-connection-${id}`}
            variant="primary"
            size="sm"
            isDisabled={checking}
            onPress={check}
          >
            {checking ? COPY.checking : COPY.check}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => setEditing(true)}
          >
            {COPY.edit}
          </Button>
          <Button
            id={`btn-delete-model-connection-${id}`}
            variant="secondary"
            size="sm"
            onPress={() => setConfirmingDelete(true)}
          >
            {COPY.delete}
          </Button>
        </div>

        {/* Destructive confirmation (#250): the alert dialog owns the focus trap,
            the overlay stack's Escape and the closing motion, so the card keeps
            no hand-built dialog of its own. */}
        <AlertDialog
          id={`model-confirm-${id}`}
          isOpen={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          title={COPY.confirmDelete}
          description={COPY.confirmDeleteQuestion(connection.name)}
          confirmText={COPY.confirmDelete}
          cancelText={COPY.cancel}
          variant="danger"
          onConfirm={() => mutations.remove.mutate(id)}
        />

        {checkResult && !checkResult.ok && (
          <FeedbackBanner tone="error" message={checkResult.error.message} />
        )}
        {checkError && <FeedbackBanner tone="error" message={checkError} />}

        {(found.length > 0 || connection.models.length > 0) && (
          <ModelsTable
            connection={connection}
            found={found}
            mutations={mutations}
          />
        )}
      </Card>
    </li>
  );
}

export function ModelConnectionsPanel() {
  const query = useModelConnections();
  const mutations = useModelConnectionMutations();
  const [adding, setAdding] = useState(false);
  const connections = query.data ?? [];
  const derived = deriveAsyncState(query, {
    isEmpty: () => query.data !== undefined && query.data.length === 0,
  });

  return (
    <section
      className="model-connections"
      aria-labelledby="model-connections-title"
    >
      <div className="model-connections-head">
        <div>
          <h3 id="model-connections-title">{COPY.title}</h3>
          <p className="text-muted">{COPY.subtitle}</p>
        </div>
        {!adding && (
          <Button
            id="btn-add-model-connection"
            variant="primary"
            size="sm"
            onPress={() => setAdding(true)}
          >
            {COPY.add}
          </Button>
        )}
      </div>

      {adding && (
        <ConnectionForm mutations={mutations} onDone={() => setAdding(false)} />
      )}

      <AsyncRegion
        derived={derived}
        onRetry={() => void query.refetch()}
        emptyCopy={COPY.empty}
      >
        <ul className="model-connection-list">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              mutations={mutations}
            />
          ))}
        </ul>
      </AsyncRegion>
    </section>
  );
}
