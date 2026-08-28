import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DETECTOR_KEY, EMITTER_KEY, EXTENSION_NAME } from "./constants";
import { parseDetectorMetadata, parseEmitterMetadata } from "./metadata/parse";
import { DEBUG_STORAGE_KEY } from "./runtime/engine";
import { normalizeSignal } from "./signals/normalize";
import type { DebugRuleState, DetectionRuleV1, DetectorMetadataV1, EffectAudienceV1, EffectTargetV1, EmitterMetadataV1, ShaderEffectDefinitionV1 } from "./types";
import { StatusPanel } from "./components/StatusPanel";
import { useOwlbear } from "./hooks/useOwlbear";

const newEffect = (): ShaderEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" }, preset: "glow", color: "#55aaff", maxIntensity: 1, spread: 1.25, animation: { rate: 1, depth: 0.35 } });
const newRule = (): DetectionRuleV1 => ({ id: crypto.randomUUID(), enabled: true, signal: "signal", aggregation: "nearest", range: { outer: 60, inner: 5 }, falloff: "smoothstep", effects: [newEffect()] });
const Label = ({ children }: { children: React.ReactNode }) => <span className="field-label">{children}</span>;

export default function App() {
  const connection = useOwlbear();
  const [items, setItems] = useState<Item[]>([]);
  const [party, setParty] = useState<Player[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [emitter, setEmitter] = useState<EmitterMetadataV1>({ version: 1, signals: [] });
  const [detector, setDetector] = useState<DetectorMetadataV1>({ version: 1, enabled: true, rules: [] });
  const [signalDraft, setSignalDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [debug, setDebug] = useState<DebugRuleState[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [gridUnit, setGridUnit] = useState("");
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const sceneSignals = useMemo(() => [...new Set(items.flatMap((item) => parseEmitterMetadata(item.metadata[EMITTER_KEY])?.signals ?? []))].sort(), [items]);

  const loadSelection = useCallback(async (nextItems?: Item[]) => {
    const allItems = nextItems ?? await OBR.scene.items.getItems();
    setItems(allItems);
    const selection = await OBR.player.getSelection();
    setSelectedId(selection?.length === 1 ? selection[0] : null);
  }, []);

  useEffect(() => {
    if (connection.status !== "ready" || !connection.sceneReady) return;
    void loadSelection();
    void OBR.party.getPlayers().then(setParty);
    void OBR.scene.grid.getScale().then((scale) => setGridUnit(scale.parsed.unit));
    const stopItems = OBR.scene.items.onChange((next) => void loadSelection(next));
    const stopPlayer = OBR.player.onChange(() => void loadSelection());
    const stopParty = OBR.party.onChange(setParty);
    const stopGrid = OBR.scene.grid.onChange(() => void OBR.scene.grid.getScale().then((scale) => setGridUnit(scale.parsed.unit)));
    return () => { stopItems(); stopPlayer(); stopParty(); stopGrid(); };
  }, [connection.sceneReady, connection.status, loadSelection]);

  useEffect(() => {
    if (!selected) return;
    setEmitter(parseEmitterMetadata(selected.metadata[EMITTER_KEY]) ?? { version: 1, signals: [] });
    setDetector(parseDetectorMetadata(selected.metadata[DETECTOR_KEY]) ?? { version: 1, enabled: true, rules: [] });
    setSaved(false);
  }, [selected?.id, selected?.lastModified]);

  useEffect(() => {
    if (!showDebug) return;
    const refresh = () => { try { setDebug(JSON.parse(localStorage.getItem(DEBUG_STORAGE_KEY) ?? "{}").rules ?? []); } catch { setDebug([]); } };
    refresh();
    const timer = window.setInterval(refresh, 750);
    return () => window.clearInterval(timer);
  }, [showDebug]);

  const updateRule = (index: number, update: (rule: DetectionRuleV1) => DetectionRuleV1) => setDetector((current) => ({ ...current, rules: current.rules.map((rule, i) => i === index ? update(rule) : rule) }));
  const updateEffect = (ruleIndex: number, effectIndex: number, update: (effect: ShaderEffectDefinitionV1) => ShaderEffectDefinitionV1) => updateRule(ruleIndex, (rule) => ({ ...rule, effects: rule.effects.map((effect, i) => i === effectIndex ? update(effect) : effect) }));
  const addSignal = () => { const value = normalizeSignal(signalDraft); if (value && !emitter.signals.includes(value)) setEmitter({ version: 1, signals: [...emitter.signals, value] }); setSignalDraft(""); };

  const save = async () => {
    if (!selected || connection.role !== "GM") return;
    const normalizedDetector = parseDetectorMetadata(detector);
    if (detector.rules.length && !normalizedDetector) {
      setSaveError("Fix invalid rules: signals are required, outer range must be positive, and inner range must be below outer range.");
      return;
    }
    const normalizedEmitter = parseEmitterMetadata(emitter) ?? { version: 1 as const, signals: [] };
    setSaveError(null);
    setSaving(true);
    try {
      await OBR.scene.items.updateItems([selected.id], (drafts) => {
        for (const item of drafts) {
          if (normalizedEmitter.signals.length) item.metadata[EMITTER_KEY] = normalizedEmitter; else delete item.metadata[EMITTER_KEY];
          if (normalizedDetector?.rules.length) item.metadata[DETECTOR_KEY] = normalizedDetector; else delete item.metadata[DETECTOR_KEY];
        }
      });
      setSaved(true); window.setTimeout(() => setSaved(false), 1800);
    } finally { setSaving(false); }
  };

  if (connection.status === "connecting") return <StatusPanel title="Connecting to Owlbear Rodeo" message="Waiting for the room SDK to become ready…" />;
  if (connection.status === "error") return <StatusPanel title="Extension unavailable" message={connection.error ?? "Unable to initialize."} onRetry={() => void connection.refresh()} />;

  return <main className="app-shell">
    <header className="app-header"><div><span className="eyebrow">Proximity rules engine</span><h1>{EXTENSION_NAME}</h1></div><button className="secondary-button" onClick={() => setShowDebug((value) => !value)}>{showDebug ? "Editor" : "Debug"}</button></header>
    {!connection.sceneReady && <div className="notice">Open a scene to configure proximity signals.</div>}
    {connection.sceneReady && connection.role !== "GM" && <div className="notice">The runtime is active. Only the GM can configure scene items.</div>}
    {connection.sceneReady && connection.role === "GM" && !selected && <div className="notice">Select exactly one scene item to configure it.</div>}
    {showDebug ? <DebugView rules={debug} /> : selected && connection.role === "GM" ? <>
      <section className="item-heading"><span className="eyebrow">Selected item</span><h2>{selected.name || "Unnamed item"}</h2><code>{selected.id}</code></section>
      <section className="content-card"><h2>Emitter</h2><p className="muted">Advertise arbitrary facts; ranges and responses belong on detectors.</p><div className="chips">{emitter.signals.map((signal) => <button key={signal} className="chip" onClick={() => setEmitter({ version: 1, signals: emitter.signals.filter((value) => value !== signal) })}>{signal}<span>×</span></button>)}</div><div className="input-row"><input list="scene-signals" value={signalDraft} placeholder="Add signal…" onChange={(event) => setSignalDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSignal(); } }} /><button onClick={addSignal}>Add</button></div><datalist id="scene-signals">{sceneSignals.map((signal) => <option key={signal} value={signal} />)}</datalist></section>
      <section className="content-card"><div className="section-title"><div><h2>Detector</h2><p className="muted">Each rule produces one strength shared by all of its effects.</p></div><label className="toggle"><input type="checkbox" checked={detector.enabled} onChange={(event) => setDetector({ ...detector, enabled: event.target.checked })} /> Enabled</label></div>{detector.rules.map((rule, ruleIndex) => <RuleEditor key={rule.id} rule={rule} index={ruleIndex} unit={gridUnit} items={items} party={party} onChange={(update) => updateRule(ruleIndex, update)} onEffect={(effectIndex, update) => updateEffect(ruleIndex, effectIndex, update)} onDelete={() => setDetector({ ...detector, rules: detector.rules.filter((_, i) => i !== ruleIndex) })} />)}<button className="wide-button" onClick={() => setDetector({ ...detector, rules: [...detector.rules, newRule()] })}>+ Add detection rule</button></section>
      {saveError && <div className="validation-error" role="alert">{saveError}</div>}<div className="save-bar"><span>{saved ? "Saved" : "Changes are stored on the selected item."}</span><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save configuration"}</button></div>
    </> : null}
  </main>;
}

interface RuleEditorProps { rule: DetectionRuleV1; index: number; unit: string; items: Item[]; party: Player[]; onChange: (update: (rule: DetectionRuleV1) => DetectionRuleV1) => void; onEffect: (index: number, update: (effect: ShaderEffectDefinitionV1) => ShaderEffectDefinitionV1) => void; onDelete: () => void; }
function RuleEditor({ rule, index, unit, items, party, onChange, onEffect, onDelete }: RuleEditorProps) {
  return <article className="rule-card"><div className="section-title"><h3>Rule {index + 1}</h3><label className="toggle"><input type="checkbox" checked={rule.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /> Active</label></div><div className="form-grid">
    <label><Label>Signal</Label><input value={rule.signal} onChange={(event) => onChange((value) => ({ ...value, signal: event.target.value }))} /></label>
    <label><Label>Falloff</Label><select value={rule.falloff} onChange={(event) => onChange((value) => ({ ...value, falloff: event.target.value as DetectionRuleV1["falloff"] }))}><option value="smoothstep">Smooth</option><option value="linear">Linear</option><option value="binary">Binary</option></select></label>
    <label><Label>Outer range {unit && `(${unit})`}</Label><input type="number" min="0.01" step="0.5" value={rule.range.outer} onChange={(event) => onChange((value) => ({ ...value, range: { ...value.range, outer: Number(event.target.value) } }))} /></label>
    <label><Label>Full strength at {unit && `(${unit})`}</Label><input type="number" min="0" step="0.5" value={rule.range.inner} onChange={(event) => onChange((value) => ({ ...value, range: { ...value.range, inner: Number(event.target.value) } }))} /></label>
  </div><div className="effects-heading"><h4>Effects <span>{rule.effects.length}</span></h4></div>{rule.effects.map((effect, effectIndex) => <EffectEditor key={effect.id} effect={effect} items={items} party={party} onChange={(update) => onEffect(effectIndex, update)} onDelete={() => onChange((value) => ({ ...value, effects: value.effects.filter((_, i) => i !== effectIndex) }))} />)}<div className="card-actions"><button onClick={() => onChange((value) => ({ ...value, effects: [...value.effects, newEffect()] }))}>+ Add effect</button><button className="danger" onClick={onDelete}>Delete rule</button></div></article>;
}

function EffectEditor({ effect, items, party, onChange, onDelete }: { effect: ShaderEffectDefinitionV1; items: Item[]; party: Player[]; onChange: (update: (effect: ShaderEffectDefinitionV1) => ShaderEffectDefinitionV1) => void; onDelete: () => void }) {
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  const setAudience = (type: EffectAudienceV1["type"]) => onChange((value) => ({ ...value, audience: type === "specific-users" ? { type, userIds: [] } : { type } }));
  return <div className="effect-card"><div className="section-title"><strong>{effect.preset[0].toUpperCase() + effect.preset.slice(1)}</strong><label className="toggle"><input type="checkbox" checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /> Enabled</label></div><div className="form-grid">
    <label><Label>Preset</Label><select value={effect.preset} onChange={(event) => onChange((value) => ({ ...value, preset: event.target.value as ShaderEffectDefinitionV1["preset"] }))}><option value="glow">Glow</option><option value="pulse">Pulse</option><option value="flicker">Flicker</option><option value="outline">Outline</option></select></label>
    <label><Label>Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Detector</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter</option><option value="specific-item">Specific item</option></select></label>
    {effect.target.type === "specific-item" && <label className="wide"><Label>Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
    <label><Label>Audience</Label><select value={effect.audience.type} onChange={(event) => setAudience(event.target.value as EffectAudienceV1["type"])}><option value="everyone">Everyone</option><option value="gm">GM only</option><option value="players">Players</option><option value="detector-owner">Detector owner</option><option value="carrier-owner">Carrier owner</option><option value="target-owner">Target owner</option><option value="specific-users">Specific users</option></select></label>
    <label><Label>Color</Label><input type="color" value={effect.color} onChange={(event) => onChange((value) => ({ ...value, color: event.target.value }))} /></label>
    <label><Label>Maximum intensity</Label><input type="range" min="0" max="2" step="0.05" value={effect.maxIntensity} onChange={(event) => onChange((value) => ({ ...value, maxIntensity: Number(event.target.value) }))} /><output>{effect.maxIntensity.toFixed(2)}</output></label>
    <label><Label>Spread</Label><input type="range" min="0.1" max="4" step="0.05" value={effect.spread} onChange={(event) => onChange((value) => ({ ...value, spread: Number(event.target.value) }))} /><output>{effect.spread.toFixed(2)}</output></label>
    {(effect.preset === "pulse" || effect.preset === "flicker") && <><label><Label>Animation rate</Label><input type="number" min="0" max="10" step="0.1" value={effect.animation?.rate ?? 1} onChange={(event) => onChange((value) => ({ ...value, animation: { rate: Number(event.target.value), depth: value.animation?.depth ?? 0.35 } }))} /></label><label><Label>Animation depth</Label><input type="range" min="0" max="1" step="0.05" value={effect.animation?.depth ?? 0.35} onChange={(event) => onChange((value) => ({ ...value, animation: { rate: value.animation?.rate ?? 1, depth: Number(event.target.value) } }))} /></label></>}
  </div>{effect.audience.type === "specific-users" && <fieldset><legend>Specific users</legend>{party.length ? party.map((player) => <label className="user-check" key={player.id}><input type="checkbox" checked={effect.audience.type === "specific-users" && effect.audience.userIds.includes(player.id)} onChange={(event) => onChange((value) => { const audience = value.audience.type === "specific-users" ? value.audience : { type: "specific-users" as const, userIds: [] }; return { ...value, audience: { ...audience, userIds: event.target.checked ? [...audience.userIds, player.id] : audience.userIds.filter((id) => id !== player.id) } }; })} />{player.name} <small>{player.role}</small></label>) : <p className="muted">No connected users. Stored offline IDs are retained.</p>}</fieldset>}<button className="danger text-button" onClick={onDelete}>Delete effect</button></div>;
}

function DebugView({ rules }: { rules: DebugRuleState[] }) {
  return <section className="content-card debug-view"><h2>Local runtime</h2><p className="muted">Derived state from this client only. Nothing here is stored in scene metadata.</p>{rules.length === 0 ? <div className="notice">No active detector rules.</div> : rules.map((rule) => <article key={`${rule.detectorId}:${rule.ruleId}`}><h3>{rule.detectorName}</h3><code>{rule.signal} · {rule.range.outer}</code><dl className="facts"><div><dt>Matches</dt><dd>{rule.matchingEmitterCount}</dd></div><div><dt>Nearest</dt><dd>{rule.emitterName ?? "None"}</dd></div><div><dt>Distance</dt><dd>{rule.distance?.toFixed(2) ?? "—"}</dd></div><div><dt>Strength</dt><dd>{rule.strength.toFixed(3)}</dd></div></dl>{rule.effects.map((effect) => <div className="debug-effect" key={effect.effectId}><strong>{effect.targetType} → {effect.targetName ?? "unresolved"}</strong><span>{effect.audience} · {effect.audienceMatch ? "audience match" : "not visible here"}</span><code>{effect.localItemId ?? "no local effect"}</code></div>)}</article>)}</section>;
}
