"use client";

import { useRef, useState } from "react";
import type { ModelOption } from "@code-arena/contracts";

export default function ModelPicker({
  value,
  models,
  status,
  error,
  disabled,
  onChange,
  onRetry,
}: {
  value: string;
  models: ModelOption[];
  status: "loading" | "ready" | "error";
  error: string;
  disabled: boolean;
  onChange(value: string): void;
  onRetry(): void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const selected = models.find((model) => model.id === value);
  const query = selected ? "" : value.trim().toLowerCase();
  const matches = models.filter((model) =>
    `${model.name ?? ""} ${model.id}`.toLowerCase().includes(query),
  );
  const options = matches.slice(0, 40);
  const expanded = open && !disabled;
  const activeOption = options[active];

  function choose(model: ModelOption) {
    onChange(model.id);
    setOpen(false);
    setActive(-1);
  }

  return (
    <>
      <div
        className="model-picker"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        <div className="model-input">
          <input
            ref={input}
            id="model"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls="model-options"
            aria-activedescendant={
              expanded && activeOption ? `model-option-${active}` : undefined
            }
            aria-describedby="model-help"
            autoComplete="off"
            value={value}
            placeholder="Search popular models or enter an ID"
            disabled={disabled}
            maxLength={200}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              onChange(event.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
                setActive(-1);
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                const next = event.key === "ArrowDown"
                  ? Math.min(active + 1, options.length - 1)
                  : active < 0 ? options.length - 1 : Math.max(active - 1, 0);
                setActive(next);
                document.getElementById(`model-option-${next}`)?.scrollIntoView({ block: "nearest" });
              } else if (event.key === "Enter" && expanded && activeOption) {
                event.preventDefault();
                choose(activeOption);
              }
            }}
          />
          <button
            type="button"
            className="model-toggle"
            aria-label={expanded ? "Close model list" : "Browse popular models"}
            aria-expanded={expanded}
            aria-controls="model-options"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              input.current?.focus();
              setOpen(!expanded);
              setActive(-1);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
        {expanded && (
          <div className="model-menu">
            <div className="model-menu-heading">
              <span>{query ? "MATCHING MODELS" : "POPULAR ON OPENROUTER"}</span>
              <span>{query ? matches.length : models.length}</span>
            </div>
            <div id="model-options" role="listbox" aria-label="OpenRouter models" aria-busy={status === "loading"}>
              {options.map((model, index) => (
                <div
                  key={model.id}
                  id={`model-option-${index}`}
                  role="option"
                  aria-selected={model.id === value}
                  className={`model-option${active === index ? " active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(model)}
                >
                  {!query && <span className="model-rank">{String(index + 1).padStart(2, "0")}</span>}
                  <span className="model-option-copy">
                    <span className="model-name">{model.name ?? model.id}</span>
                    <span className="model-id">{model.id}</span>
                  </span>
                  {model.id === value && <span className="model-check" aria-hidden="true">✓</span>}
                </div>
              ))}
            </div>
            {!options.length && (
              <p className="model-empty">
                {status === "loading"
                  ? "Fetching popular models…"
                  : status === "error"
                    ? "Models unavailable. Enter an ID or retry below."
                    : query
                      ? "No matches. You can still use this model ID."
                      : "No models available. Enter a model ID to continue."}
              </p>
            )}
            {options.length > 0 && (
              <div className="model-menu-foot">
                {query ? "Results ordered by popularity" : "Ranked by weekly token usage"}
                {matches.length > options.length && " · Type to find more"}
              </div>
            )}
          </div>
        )}
      </div>
      <p id="model-help" className="field-help model-help" role="status">
        {status === "loading" ? "Loading popular models from OpenRouter…" : status === "error" ? (
          <>
            <span title={error}>Could not load models. Enter an ID or </span>
            <button type="button" className="model-retry" onClick={onRetry}>retry</button>.
          </>
        ) : selected ? selected.name ?? selected.id : models.length ? (
          `${models.length.toLocaleString()} tool-capable models · Popular first`
        ) : "Enter an OpenRouter model ID to begin."}
      </p>
    </>
  );
}
