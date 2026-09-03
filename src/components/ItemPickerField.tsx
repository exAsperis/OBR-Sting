import { useEffect, useRef, useState } from "react";
import type { Item } from "@owlbear-rodeo/sdk";
import { cancelItemPick, pickSceneItem } from "../runtime/itemPicker";
import { itemLabelText } from "../scene/itemText";

export function pickedRuleValue(item: Item, type: "item-name" | "item-label"): string {
  return (type === "item-name" ? item.name : itemLabelText(item)).trim();
}

interface PickButtonProps {
  items: Item[];
  onPick: (item: Item) => string | void;
  onError?: (message: string | null) => void;
}

export function PickSceneItemButton({ items, onPick, onError }: PickButtonProps) {
  const [picking, setPicking] = useState(false);
  const mounted = useRef(true);
  const ownsPick = useRef(false);
  useEffect(() => () => { mounted.current = false; if (ownsPick.current) void cancelItemPick(); }, []);
  const pick = async () => {
    if (picking) { await cancelItemPick(); setPicking(false); return; }
    setPicking(true);
    ownsPick.current = true;
    onError?.(null);
    const item = await pickSceneItem();
    ownsPick.current = false;
    if (mounted.current) setPicking(false);
    if (!item) return;
    if (!items.some((candidate) => candidate.id === item.id)) { onError?.("That item cannot be used by this field."); return; }
    const error = onPick(item);
    if (error) onError?.(error);
  };
  return <button type="button" className={`item-picker-button${picking ? " active" : ""}`} aria-pressed={picking} onClick={() => void pick()}>{picking ? "Picking…" : "Pick"}</button>;
}

export function SpecificItemField({ items, value, label = "Specific item", tooltip, onChange }: { items: Item[]; value: string; label?: string; tooltip?: string; onChange: (itemId: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  return <div className="specific-item-field wide" title={tooltip}><span className="field-label">{label}</span><div className="item-picker-row"><select aria-label={label} value={value} onChange={(event) => { setError(null); onChange(event.target.value); }}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select><PickSceneItemButton items={items} onError={setError} onPick={(item) => onChange(item.id)} /></div>{error && <small className="field-error" role="alert">{error}</small>}</div>;
}
