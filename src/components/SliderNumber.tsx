import { useEffect, useState } from "react";
import { useAllowOutOfBounds } from "./NumericLimits";

interface SliderNumberProps {
  label: string;
  labelContent?: React.ReactNode;
  value: number;
  min: number;
  max?: number;
  step: number;
  inputStep?: number;
  onChange: (value: number) => void;
  decimals?: number;
  suffix?: string;
  className?: string;
  tooltip?: string;
  editReplacesSlider?: boolean;
}

function stepDecimals(step: number): number {
  const text = String(step);
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

export function SliderNumber({ label, labelContent, value, min, max, step, inputStep = step, onChange, decimals = stepDecimals(inputStep), suffix = "", className, tooltip, editReplacesSlider = false }: SliderNumberProps) {
  const allowOutOfBounds = useAllowOutOfBounds();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const sliderMax = max ?? Math.max(200, Math.ceil(value / 50) * 50);
  const outOfBounds = value < min || max !== undefined && value > max;

  useEffect(() => { if (!editing) setDraft(String(value)); }, [editing, value]);

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      const bounded = allowOutOfBounds ? parsed : Math.min(max ?? Infinity, Math.max(min, parsed));
      const stepped = min + Math.round((bounded - min) / inputStep) * inputStep;
      onChange(Number(stepped.toFixed(Math.max(decimals, stepDecimals(inputStep)))));
    }
    setEditing(false);
  };
  const cancel = () => {
    setDraft(String(value));
    setEditing(false);
  };
  const editor = (className: string) => <div className={`numeric-editor ${className}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit(); }}>
    <input type="number" min={allowOutOfBounds ? undefined : min} max={allowOutOfBounds ? undefined : max} step={inputStep} value={draft} autoFocus onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") { event.preventDefault(); cancel(); } }} aria-label={`Edit ${label}`} />
    <button type="button" className="numeric-editor-action cancel" title="Cancel" aria-label={`Cancel editing ${label}`} onClick={cancel}>❌</button>
    <button type="button" className="numeric-editor-action confirm" title="Apply" aria-label={`Apply ${label}`} onClick={commit}>✔️</button>
  </div>;

  return <div className={`numeric-control${className ? ` ${className}` : ""}`} title={tooltip}>
    <div className="numeric-heading">{labelContent ?? <span className="field-label">{label}</span>}{editing && !editReplacesSlider
      ? editor("numeric-direct-editor")
      : <button className="numeric-value" type="button" onClick={() => setEditing(true)} aria-label={`Edit ${label}: ${value}`}>{value.toFixed(decimals)}{suffix}</button>}
    </div>
    {editing && editReplacesSlider
      ? editor("range-direct-editor")
      : <input className={outOfBounds ? "out-of-bounds" : undefined} type="range" min={min} max={sliderMax} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} />}
  </div>;
}
