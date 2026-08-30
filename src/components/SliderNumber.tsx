import { useEffect, useState } from "react";

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
}

function stepDecimals(step: number): number {
  const text = String(step);
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

export function SliderNumber({ label, labelContent, value, min, max, step, inputStep = step, onChange, decimals = stepDecimals(inputStep), suffix = "", className, tooltip }: SliderNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const sliderMax = max ?? Math.max(200, Math.ceil(value / 50) * 50);

  useEffect(() => { if (!editing) setDraft(String(value)); }, [editing, value]);

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(max ?? Infinity, Math.max(min, parsed));
      const stepped = min + Math.round((clamped - min) / inputStep) * inputStep;
      onChange(Number(stepped.toFixed(Math.max(decimals, stepDecimals(inputStep)))));
    }
    setEditing(false);
  };

  return <div className={`numeric-control${className ? ` ${className}` : ""}`} title={tooltip}>
    <div className="numeric-heading">{labelContent ?? <span className="field-label">{label}</span>}{editing
      ? <input className="numeric-direct-input" type="number" min={min} max={max} step={inputStep} value={draft} autoFocus onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.preventDefault(); setDraft(String(value)); setEditing(false); } }} aria-label={`Edit ${label}`} />
      : <button className="numeric-value" type="button" onClick={() => setEditing(true)} aria-label={`Edit ${label}: ${value}`}>{value.toFixed(decimals)}{suffix}</button>}
    </div>
    <input type="range" min={min} max={sliderMax} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} />
  </div>;
}
