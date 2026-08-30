import { useState } from "react";

export function SignalCombobox({ value, options, onChange, onEnter }: { value: string; options: string[]; onChange: (value: string) => void; onEnter: () => void }) {
  const [open, setOpen] = useState(false);
  const matches = options.filter((option) => !value || option.toLowerCase().includes(value.toLowerCase()));
  return <div className="signal-combobox">
    <input role="combobox" aria-label="Signal tag this item advertises." aria-expanded={open} aria-controls="signal-options" value={value} placeholder="Add signal…" onFocus={() => setOpen(true)} onChange={(event) => { onChange(event.target.value); setOpen(true); }} onBlur={() => window.setTimeout(() => setOpen(false), 100)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onEnter(); setOpen(false); } if (event.key === "Escape") setOpen(false); }} />
    <button type="button" className="combo-trigger" aria-label="Show existing signals" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen((value) => !value)}>⌄</button>
    {open && matches.length > 0 && <div className="combo-options" id="signal-options" role="listbox">{matches.map((option) => <button type="button" role="option" key={option} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option); setOpen(false); }}>{option}</button>)}</div>}
  </div>;
}
