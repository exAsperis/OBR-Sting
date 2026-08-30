import { useEffect, useState } from "react";

export function EditableTitle({ value, fallback, onChange, as = "strong", ariaLabel = "Edit name" }: {
  value?: string;
  fallback: string;
  onChange: (value: string | undefined) => void;
  as?: "strong" | "h3";
  ariaLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? fallback);
  useEffect(() => { if (!editing) setDraft(value ?? fallback); }, [editing, fallback, value]);
  const commit = () => {
    const next = draft.trim().slice(0, 80);
    onChange(next && next !== fallback ? next : undefined);
    setEditing(false);
  };
  if (editing) return <input className="editable-title-input" value={draft} maxLength={80} autoFocus onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.preventDefault(); setDraft(value ?? fallback); setEditing(false); } }} aria-label={ariaLabel} />;
  const titleButton = <button type="button" className="editable-title" title="Select to rename" onClick={() => setEditing(true)}>{value ?? fallback}</button>;
  return as === "h3" ? <h3>{titleButton}</h3> : <strong>{titleButton}</strong>;
}
