"use client";
export default function RunToggle({
  compare,
  onChange,
  disabled = false,
}: {
  compare: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <div className="run-toggle" role="group" aria-label="Run mode">
      <button
        type="button"
        aria-pressed={!compare}
        disabled={disabled}
        onClick={() => onChange(false)}
      >
        Single run
      </button>
      <button
        type="button"
        aria-pressed={compare}
        disabled={disabled}
        onClick={() => onChange(true)}
      >
        Compare <span aria-hidden="true">Ⅱ</span>
      </button>
    </div>
  );
}
