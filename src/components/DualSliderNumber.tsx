interface DualSliderNumberProps {
  label: string;
  labelContent: React.ReactNode;
  minimumValue: number;
  maximumValue: number;
  min: number;
  max?: number;
  minimumMin?: number;
  maximumMin?: number;
  step: number;
  suffix?: string;
  className?: string;
  tooltip?: string;
  order?: "free" | "ascending" | "descending";
  minimumEndpointLabel?: string;
  maximumEndpointLabel?: string;
  onChange: (minimumValue: number, maximumValue: number) => void;
}

export function DualSliderNumber({ label, labelContent, minimumValue, maximumValue, min, max, minimumMin = min, maximumMin = min, step, suffix = "", className, tooltip, order = "free", minimumEndpointLabel = `${label} at minimum detection`, maximumEndpointLabel = `${label} at maximum detection`, onChange }: DualSliderNumberProps) {
  const allowOutOfBounds = useAllowOutOfBounds();
  const [editing, setEditing] = useState(false);
  const [minimumDraft, setMinimumDraft] = useState(String(minimumValue));
  const [maximumDraft, setMaximumDraft] = useState(String(maximumValue));
  const minimumInputRef = useRef<HTMLInputElement>(null);
  const sliderMax = max ?? Math.max(200, Math.ceil(Math.max(minimumValue, maximumValue) / 50) * 50);
  const span = sliderMax - min || 1;
  const minimumPercent = (minimumValue - min) / span * 100;
  const maximumPercent = (maximumValue - min) / span * 100;
  const lowPercent = Math.min(minimumPercent, maximumPercent);
  const highPercent = Math.max(minimumPercent, maximumPercent);
  const crossed = minimumValue > maximumValue;
  const minimumOutOfBounds = minimumValue < minimumMin || max !== undefined && minimumValue > max;
  const maximumOutOfBounds = maximumValue < maximumMin || max !== undefined && maximumValue > max;
  useEffect(() => {
    if (!editing) { setMinimumDraft(String(minimumValue)); setMaximumDraft(String(maximumValue)); }
  }, [editing, maximumValue, minimumValue]);
  useEffect(() => {
    if (!editing) return;
    minimumInputRef.current?.focus();
    minimumInputRef.current?.select();
  }, [editing]);
  const commit = () => {
    const parsedMinimum = Number(minimumDraft);
    const parsedMaximum = Number(maximumDraft);
    let nextMinimum = Number.isFinite(parsedMinimum) ? allowOutOfBounds ? parsedMinimum : Math.min(max ?? Infinity, Math.max(minimumMin, parsedMinimum)) : minimumValue;
    let nextMaximum = Number.isFinite(parsedMaximum) ? allowOutOfBounds ? parsedMaximum : Math.min(max ?? Infinity, Math.max(maximumMin, parsedMaximum)) : maximumValue;
    if (order === "ascending" && nextMinimum > nextMaximum) nextMinimum = nextMaximum;
    if (order === "descending" && nextMaximum > nextMinimum) nextMaximum = nextMinimum;
    onChange(nextMinimum, nextMaximum);
    setEditing(false);
  };
  const cancel = () => {
    setMinimumDraft(String(minimumValue));
    setMaximumDraft(String(maximumValue));
    setEditing(false);
  };
  return <div className={`numeric-control${className ? ` ${className}` : ""}`} title={tooltip}>
    <div className="numeric-heading dual-numeric-heading">{labelContent}<button type="button" className="numeric-value dual-numeric-value" onClick={() => setEditing(true)} aria-label={`Edit ${label}: ${minimumValue} to ${maximumValue}`}>{minimumValue} – {maximumValue}{suffix}</button></div>
    {editing ? <div className="dual-range-inputs" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit(); }}>
      <input ref={minimumInputRef} type="number" min={allowOutOfBounds ? undefined : minimumMin} max={allowOutOfBounds ? undefined : max} step={step} value={minimumDraft} autoFocus onFocus={(event) => event.currentTarget.select()} onChange={(event) => setMinimumDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") cancel(); }} aria-label={`Edit ${minimumEndpointLabel}`} />
      <input type="number" min={allowOutOfBounds ? undefined : maximumMin} max={allowOutOfBounds ? undefined : max} step={step} value={maximumDraft} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setMaximumDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") cancel(); }} aria-label={`Edit ${maximumEndpointLabel}`} />
      <button type="button" className="numeric-editor-action cancel" title="Cancel" aria-label={`Cancel editing ${label}`} onClick={cancel}>❌</button>
      <button type="button" className="numeric-editor-action confirm" title="Apply" aria-label={`Apply ${label}`} onClick={commit}>✔️</button>
    </div> : <div className={`dual-range${crossed ? " crossed" : ""}`} style={{ "--range-low": `${lowPercent}%`, "--range-high": `${highPercent}%` } as React.CSSProperties}>
      <input className={`minimum-thumb${minimumOutOfBounds ? " out-of-bounds" : ""}`} type="range" min={minimumMin} max={sliderMax} step={step} value={minimumValue} onChange={(event) => { const next = Number(event.target.value); onChange(order === "ascending" ? Math.min(next, maximumValue) : order === "descending" ? Math.max(next, maximumValue) : next, maximumValue); }} aria-label={minimumEndpointLabel} />
      <input className={`maximum-thumb${maximumOutOfBounds ? " out-of-bounds" : ""}`} type="range" min={maximumMin} max={sliderMax} step={step} value={maximumValue} onChange={(event) => { const next = Number(event.target.value); onChange(minimumValue, order === "ascending" ? Math.max(next, minimumValue) : order === "descending" ? Math.min(next, minimumValue) : next); }} aria-label={maximumEndpointLabel} />
    </div>}
  </div>;
}
import { useEffect, useRef, useState } from "react";
import { useAllowOutOfBounds } from "./NumericLimits";
