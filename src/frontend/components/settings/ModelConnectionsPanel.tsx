// src/frontend/components/settings/ModelConnectionsPanel.tsx — Settings ›
// Models: add a model connection, Check Connection, choose models from what
// the check found, and edit each model's details, limits and budget (#277).
// Keys are typed into a password field and never shown again: the API only
// ever returns their last four characters.

import "./ModelConnectionsPanel.css";

import { useState } from "react";
import {
  MODEL_API_TYPES,
  type ModelApiType,
  type ModelConnectionView,
  type ModelListResult,
  type ModelRecord,
  type ModelRecordPatch,
} from "../../../shared/model-connection-types.js";
import {
  useModelConnectionMutations,
  useModelConnections,
} from "../../hooks/useModelConnections.js";
import { AsyncRegion } from "../feedback/AsyncRegion.js";
import { MODEL_CONNECTIONS_COPY as COPY } from "../feedback/copy-map.js";
import { deriveAsyncState } from "../feedback/derive-async-state.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";

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
    if (initial) {
      mutations.update.mutate(
        {
          id: initial.id,
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          ...(key ? { apiKey: key } : {}),
        },
        { onSuccess: onDone },
      );
    } else {
      mutations.create.mutate(
        {
          name: name.trim(),
          apiType,
          baseUrl: baseUrl.trim(),
          ...(key ? { apiKey: key } : {}),
        },
        { onSuccess: onDone },
      );
    }
  };

  return (
    <form className="model-connection-form" onSubmit={submit} noValidate>
      <div className="model-connection-grid">
        <label className="model-field" htmlFor="model-connection-name">
          <span className="model-field-label">{COPY.name}</span>
          <input
            id="model-connection-name"
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="model-field" htmlFor="model-connection-type">
          <span className="model-field-label">{COPY.apiType}</span>
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
          <span className="model-field-label">{COPY.baseUrl}</span>
          <input
            id="model-connection-url"
            className="form-input"
            value={baseUrl}
            placeholder="https://openrouter.ai/api/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label className="model-field" htmlFor="model-connection-key">
          <span className="model-field-label">{COPY.apiKey}</span>
          <input
            id="model-connection-key"
            className="form-input"
            type="password"
            autoComplete="off"
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
        <button type="button" className="btn-secondary btn-sm" onClick={onDone}>
          {COPY.cancel}
        </button>
        <button
          type="submit"
          id="btn-save-model-connection"
          className="btn-primary btn-sm"
          disabled={saving.isPending}
        >
          {COPY.save}
        </button>
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
const ALL_FIELDS: readonly FormKey[] = [
  ...DETAIL_FIELDS,
  ...LIMIT_FIELDS,
  "budgetUsd",
  "budgetRequests",
];

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
      <h5 className="model-details-title">{model.name ?? model.modelId}</h5>
      <div className="model-details-grid">
        {ALL_FIELDS.map((key) => (
          <label key={key} className="model-field" htmlFor={`${prefix}-${key}`}>
            <span className="model-field-label">{COPY[key]}</span>
            <input
              id={`${prefix}-${key}`}
              className="form-input"
              inputMode="decimal"
              value={values[key]}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [key]: e.target.value }))
              }
            />
          </label>
        ))}
      </div>
      <div className="model-actions">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() =>
            mutations.removeModel.mutate({
              id: connectionId,
              modelId: model.modelId,
            })
          }
        >
          {COPY.removeModel}
        </button>
        <button
          type="submit"
          id={`btn-save-${prefix}`}
          className="btn-primary btn-sm"
          disabled={mutations.updateModel.isPending}
        >
          {COPY.saveModel}
        </button>
      </div>
    </form>
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
  const chosen = new Set(connection.models.map((m) => m.modelId));
  const found = checkResult?.ok ? checkResult.models : [];
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
      <li className="model-connection-card">
        <ConnectionForm
          initial={connection}
          mutations={mutations}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="model-connection-card">
      <div className="model-connection-head">
        <div>
          <strong className="model-connection-name">{connection.name}</strong>
          <span className="model-connection-meta">
            {COPY.apiTypes[connection.apiType]} · {connection.baseUrl}
          </span>
          <span className="model-connection-meta">
            {connection.keyLast4
              ? COPY.keyMasked(connection.keyLast4)
              : COPY.noKey}
            {connection.keySource === "environment" &&
              ` (${COPY.fromEnvironment})`}
          </span>
        </div>
        <span
          className={
            connection.verifiedAt
              ? "model-badge model-badge--verified"
              : "model-badge"
          }
        >
          {connection.verifiedAt ? COPY.verified : COPY.notChecked}
        </span>
      </div>

      <div className="model-actions model-actions--start">
        <button
          type="button"
          id={`btn-check-model-connection-${id}`}
          className="btn-primary btn-sm"
          disabled={checking}
          onClick={check}
        >
          {checking ? COPY.checking : COPY.check}
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setEditing(true)}
        >
          {COPY.edit}
        </button>
        <button
          type="button"
          id={`btn-delete-model-connection-${id}`}
          className="btn-secondary btn-sm"
          onClick={() => setConfirmingDelete(true)}
        >
          {COPY.delete}
        </button>
      </div>

      {confirmingDelete && (
        <div className="model-confirm" role="alertdialog" aria-live="polite">
          <p>{COPY.confirmDeleteQuestion(connection.name)}</p>
          <div className="model-actions">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setConfirmingDelete(false)}
            >
              {COPY.cancel}
            </button>
            <button
              type="button"
              id={`btn-confirm-delete-model-connection-${id}`}
              className="btn-danger btn-sm"
              onClick={() => mutations.remove.mutate(id)}
            >
              {COPY.confirmDelete}
            </button>
          </div>
        </div>
      )}

      {checkResult && !checkResult.ok && (
        <FeedbackBanner tone="error" message={checkResult.error.message} />
      )}
      {checkError && <FeedbackBanner tone="error" message={checkError} />}

      {found.length > 0 && (
        <div className="model-found">
          <p className="model-found-count">{COPY.modelsFound(found.length)}</p>
          <ul className="model-found-list">
            {found.map((model) => (
              <li key={model.id} className="model-found-row">
                <span>
                  {model.name ?? model.id}
                  {model.name && (
                    <code className="model-found-id">{model.id}</code>
                  )}
                </span>
                <button
                  type="button"
                  id={`btn-add-model-${id}-${model.id}`}
                  className="btn-secondary btn-sm"
                  disabled={chosen.has(model.id)}
                  onClick={() =>
                    mutations.addModel.mutate({ id, modelId: model.id })
                  }
                >
                  {chosen.has(model.id) ? COPY.added : COPY.addModel}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {connection.models.length > 0 && (
        <div className="model-chosen">
          <h4 className="model-chosen-title">{COPY.chosenModels}</h4>
          {connection.models.map((model) => (
            <ModelDetailsForm
              key={model.modelId}
              connectionId={id}
              model={model}
              mutations={mutations}
            />
          ))}
        </div>
      )}
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
          <button
            type="button"
            id="btn-add-model-connection"
            className="btn-primary btn-sm"
            onClick={() => setAdding(true)}
          >
            {COPY.add}
          </button>
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
