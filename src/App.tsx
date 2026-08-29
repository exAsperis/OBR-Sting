import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DETECTOR_KEY, EMANATION_INTEGRATION_KEY, EMITTER_KEY, EXTENSION_NAME } from "./constants";
import { parseDetectorMetadata, parseEmitterMetadata } from "./metadata/parse";
import { DEBUG_STORAGE_KEY } from "./runtime/engine";
import { DEFAULT_GEOMETRY, resolveShaderGeometry } from "./effects/shader/geometry";
import { createIntegrationEffect } from "./effects/integrations/catalog";
import { IntegrationEffectEditor } from "./effects/integrations/ui/IntegrationEffectEditor";
import { normalizeSignal } from "./signals/normalize";
import type { DebugRuleState, DetectionRuleV1, DetectorMetadataV1, EffectAudienceV1, EffectDefinitionV1, EffectTargetV1, EmitterMetadataV1, ShaderEffectDefinitionV1 } from "./types";
import { StatusPanel } from "./components/StatusPanel";
import { useOwlbear } from "./hooks/useOwlbear";

const newEffect = (): ShaderEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" }, preset: "glow", color: "#55aaff", maxIntensity: 1, spread: 1.25, animation: { mode: "none", rate: 1, depth: 0.35 } });
const newRule = (): DetectionRuleV1 => ({ id: crypto.randomUUID(), enabled: true, signal: "signal", aggregation: "nearest", range: { outer: 60, inner: 5 }, falloff: "smoothstep", effects: [newEffect()] });
const Label = ({ children }: { children: React.ReactNode }) => <span className="field-label">{children}</span>;
const configurationSignature = (emitter: EmitterMetadataV1, detector: DetectorMetadataV1) => JSON.stringify({
  emitter: emitter.signals.length ? emitter : null,
  detector: detector.rules.length ? detector : null,
});

export default function App() {
  const connection = useOwlbear();
  const [items, setItems] = useState<Item[]>([]);
  const [party, setParty] = useState<Player[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [emitter, setEmitter] = useState<EmitterMetadataV1>({ version: 1, signals: [] });
  const [detector, setDetector] = useState<DetectorMetadataV1>({ version: 1, enabled: true, rules: [] });
  const [signalDraft, setSignalDraft] = useState("");
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [debug, setDebug] = useState<DebugRuleState[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [gridUnit, setGridUnit] = useState("");
  const [emanationEnabled, setEmanationEnabled] = useState(() => localStorage.getItem(EMANATION_INTEGRATION_KEY) === "true");
  const hydratedItemId = useRef<string | null>(null);
  const lastSavedSignature = useRef("");
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
    const nextEmitter = parseEmitterMetadata(selected.metadata[EMITTER_KEY]) ?? { version: 1 as const, signals: [] };
    const nextDetector = parseDetectorMetadata(selected.metadata[DETECTOR_KEY]) ?? { version: 1 as const, enabled: true, rules: [] };
    setEmitter(nextEmitter);
    setDetector(nextDetector);
    setSignalDraft("");
    hydratedItemId.current = selected.id;
    lastSavedSignature.current = configurationSignature(nextEmitter, nextDetector);
    setAutosaveStatus("idle");
    setSaveError(null);
  }, [selected?.id, selected?.lastModified]);

  useEffect(() => {
    if (!showDebug) return;
    const refresh = () => { try { setDebug(JSON.parse(localStorage.getItem(DEBUG_STORAGE_KEY) ?? "{}").rules ?? []); } catch { setDebug([]); } };
    refresh();
    const timer = window.setInterval(refresh, 750);
    return () => window.clearInterval(timer);
  }, [showDebug]);

  const updateRule = (index: number, update: (rule: DetectionRuleV1) => DetectionRuleV1) => setDetector((current) => ({ ...current, rules: current.rules.map((rule, i) => i === index ? update(rule) : rule) }));
  const updateEffect = (ruleIndex: number, effectIndex: number, update: (effect: EffectDefinitionV1) => EffectDefinitionV1) => updateRule(ruleIndex, (rule) => ({ ...rule, effects: rule.effects.map((effect, i) => i === effectIndex ? update(effect) : effect) }));
  const toggleEmanation = (enabled: boolean) => { localStorage.setItem(EMANATION_INTEGRATION_KEY, String(enabled)); setEmanationEnabled(enabled); };
  const addSignal = () => { const value = normalizeSignal(signalDraft); if (value && !emitter.signals.includes(value)) setEmitter({ version: 1, signals: [...emitter.signals, value] }); setSignalDraft(""); };

  useEffect(() => {
    if (!selected || connection.role !== "GM" || hydratedItemId.current !== selected.id) return;
    const normalizedDetector = parseDetectorMetadata(detector);
    if (detector.rules.length && !normalizedDetector) {
      setSaveError("Fix invalid settings: signals are required, range and radius inner values must be below their outer values, and offsets must stay between -100% and 100%.");
      setAutosaveStatus("error");
      return;
    }
    const normalizedEmitter = parseEmitterMetadata(emitter) ?? { version: 1 as const, signals: [] };
    const normalizedDetectorValue = normalizedDetector ?? { version: 1 as const, enabled: detector.enabled, rules: [] };
    const signature = configurationSignature(normalizedEmitter, normalizedDetectorValue);
    if (signature === lastSavedSignature.current) return;
    setSaveError(null);
    setAutosaveStatus("saving");
    const timer = window.setTimeout(() => {
      void OBR.scene.items.updateItems([selected.id], (drafts) => {
        for (const item of drafts) {
          if (normalizedEmitter.signals.length) item.metadata[EMITTER_KEY] = normalizedEmitter;
          else delete item.metadata[EMITTER_KEY];
          if (normalizedDetector?.rules.length) item.metadata[DETECTOR_KEY] = normalizedDetector;
          else delete item.metadata[DETECTOR_KEY];
        }
      }).then(() => {
        lastSavedSignature.current = signature;
        setAutosaveStatus("saved");
      }).catch(() => {
        setSaveError("Unable to save this configuration. Check the room connection and try again.");
        setAutosaveStatus("error");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [connection.role, detector, emitter, selected?.id]);

  if (connection.status === "connecting") return <StatusPanel title="Connecting to Owlbear Rodeo" message="Waiting for the room SDK to become ready…" />;
  if (connection.status === "error") return <StatusPanel title="Extension unavailable" message={connection.error ?? "Unable to initialize."} onRetry={() => void connection.refresh()} />;

  return <main className="app-shell">
    <header className="app-header"><div><span className="eyebrow">Proximity sensing effects triggers</span><h1>{EXTENSION_NAME}</h1></div><button className="secondary-button" onClick={() => setShowDebug((value) => !value)}>{showDebug ? "Editor" : "Debug"}</button></header>
    {!connection.sceneReady && <div className="notice">Open a scene to configure proximity signals.</div>}
    {connection.sceneReady && connection.role !== "GM" && <div className="notice">The runtime is active. Only the GM can configure scene items.</div>}
    {connection.sceneReady && connection.role === "GM" && !selected && <div className="notice">Select exactly one scene item to configure it.</div>}
    {showDebug ? <DebugView rules={debug} /> : selected && connection.role === "GM" ? <>
      <section className="item-heading"><span className="eyebrow">Selected item</span><h2>{selected.name || "Unnamed item"}</h2><code>{selected.id}</code></section>
      <details className="content-card extensions-section">
        <summary><span><strong className="extensions-title">Extensions</strong><small>{emanationEnabled ? "1 enabled" : "None enabled"}</small></span></summary>
        <div className="extension-list">
          <div className="extension-row">
            <div><strong>Auras &amp; Emanations</strong><p className="muted">Trigger named presets through the installed extension.</p></div>
            <label className="toggle"><input type="checkbox" checked={emanationEnabled} onChange={(event) => toggleEmanation(event.target.checked)} /> Enabled</label>
          </div>
        </div>
      </details>
      <section className="content-card"><h2>Emitter</h2><p className="muted">Advertise arbitrary facts; ranges and responses belong on detectors.</p><div className="chips">{emitter.signals.map((signal) => <button key={signal} className="chip" onClick={() => setEmitter({ version: 1, signals: emitter.signals.filter((value) => value !== signal) })}>{signal}<span>×</span></button>)}</div><div className="input-row"><input list="scene-signals" value={signalDraft} placeholder="Add signal…" onChange={(event) => setSignalDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSignal(); } }} /><button onClick={addSignal}>Add</button></div><datalist id="scene-signals">{sceneSignals.map((signal) => <option key={signal} value={signal} />)}</datalist></section>
      <section className="content-card"><div className="section-title"><div><h2>Detector</h2><p className="muted">Each rule produces one strength shared by all of its effects.</p></div><label className="toggle"><input type="checkbox" checked={detector.enabled} onChange={(event) => setDetector({ ...detector, enabled: event.target.checked })} /> Enabled</label></div>{detector.rules.map((rule, ruleIndex) => <RuleEditor key={rule.id} rule={rule} index={ruleIndex} unit={gridUnit} items={items} party={party} emanationEnabled={emanationEnabled} onChange={(update) => updateRule(ruleIndex, update)} onEffect={(effectIndex, update) => updateEffect(ruleIndex, effectIndex, update)} onDelete={() => setDetector({ ...detector, rules: detector.rules.filter((_, i) => i !== ruleIndex) })} />)}<button className="wide-button" onClick={() => setDetector({ ...detector, rules: [...detector.rules, newRule()] })}>+ Add detection rule</button></section>
      {saveError && <div className="validation-error" role="alert">{saveError}</div>}<div className="autosave-status" role="status">{autosaveStatus === "saving" ? "Saving…" : autosaveStatus === "error" ? "Not saved" : "Saved automatically"}</div>
    </> : null}
  </main>;
}

interface RuleEditorProps { rule: DetectionRuleV1; index: number; unit: string; items: Item[]; party: Player[]; emanationEnabled: boolean; onChange: (update: (rule: DetectionRuleV1) => DetectionRuleV1) => void; onEffect: (index: number, update: (effect: EffectDefinitionV1) => EffectDefinitionV1) => void; onDelete: () => void; }
function RuleEditor({ rule, index, unit, items, party, emanationEnabled, onChange, onEffect, onDelete }: RuleEditorProps) {
  return <article className="rule-card"><div className="section-title"><h3>Rule {index + 1}</h3><label className="toggle"><input type="checkbox" checked={rule.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /> Active</label></div><div className="form-grid">
    <label><Label>Signal</Label><input value={rule.signal} onChange={(event) => onChange((value) => ({ ...value, signal: event.target.value }))} /></label>
    <label><Label>Falloff</Label><select value={rule.falloff} onChange={(event) => onChange((value) => ({ ...value, falloff: event.target.value as DetectionRuleV1["falloff"] }))}><option value="smoothstep">Smooth</option><option value="linear">Linear</option><option value="binary">Binary</option></select></label>
    <label><Label>Outer range {unit && `(${unit})`}</Label><input type="number" min="0.01" step="0.5" value={rule.range.outer} onChange={(event) => onChange((value) => ({ ...value, range: { ...value.range, outer: Number(event.target.value) } }))} /></label>
    <label><Label>Full strength at {unit && `(${unit})`}</Label><input type="number" min="0" step="0.5" value={rule.range.inner} onChange={(event) => onChange((value) => ({ ...value, range: { ...value.range, inner: Number(event.target.value) } }))} /></label>
  </div><div className="effects-heading"><h4>Effects <span>{rule.effects.length}</span></h4></div>{rule.effects.map((effect, effectIndex) => effect.type === "shader" ? <EffectEditor key={effect.id} effect={effect} items={items} party={party} onChange={(update) => onEffect(effectIndex, (current) => current.type === "shader" ? update(current) : current)} onDelete={() => onChange((value) => ({ ...value, effects: value.effects.filter((_, i) => i !== effectIndex) }))} /> : <IntegrationEffectEditor key={effect.id} effect={effect} items={items} providerEnabled={emanationEnabled} onChange={(update) => onEffect(effectIndex, (current) => current.type === "integration" ? update(current) : current)} onDelete={() => onChange((value) => ({ ...value, effects: value.effects.filter((_, i) => i !== effectIndex) }))} />)}<div className="card-actions"><button onClick={() => onChange((value) => ({ ...value, effects: [...value.effects, newEffect()] }))}>+ Sting effect</button><button onClick={() => onChange((value) => ({ ...value, effects: [...value.effects, createIntegrationEffect()] }))}>+ A&amp;E integration</button><button className="danger" onClick={onDelete}>Delete rule</button></div></article>;
}

function EffectEditor({ effect, items, party, onChange, onDelete }: { effect: ShaderEffectDefinitionV1; items: Item[]; party: Player[]; onChange: (update: (effect: ShaderEffectDefinitionV1) => ShaderEffectDefinitionV1) => void; onDelete: () => void }) {
  const [animationOpen, setAnimationOpen] = useState(effect.animation?.mode !== "none" && effect.animation !== undefined);
  const geometry = resolveShaderGeometry(effect);
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  const setAudience = (type: EffectAudienceV1["type"]) => onChange((value) => ({ ...value, audience: type === "specific-users" ? { type, userIds: [] } : { type } }));
  const setGeometry = (field: keyof typeof geometry, value: number) => onChange((current) => ({ ...current, geometry: { ...resolveShaderGeometry(current), [field]: value } }));
  const setAnimation = (update: Partial<NonNullable<ShaderEffectDefinitionV1["animation"]>>) => onChange((current) => ({ ...current, animation: { mode: "none", rate: 1, depth: 0.35, ...current.animation, ...update } }));
  return <div className="effect-card"><div className="section-title"><strong>{effect.preset[0].toUpperCase() + effect.preset.slice(1)}</strong><label className="toggle"><input type="checkbox" checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /> Enabled</label></div><div className="form-grid">
    <label><Label>Preset</Label><select value={effect.preset} onChange={(event) => onChange((value) => { const preset = event.target.value as ShaderEffectDefinitionV1["preset"]; return { ...value, preset, geometry: DEFAULT_GEOMETRY[preset] }; })}><option value="glow">Glow</option><option value="beam">Directional beam</option></select></label>
    <label><Label>Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Detector</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter</option><option value="specific-item">Specific item</option></select></label>
    {effect.target.type === "specific-item" && <label className="wide"><Label>Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
    <label><Label>Audience</Label><select value={effect.audience.type} onChange={(event) => setAudience(event.target.value as EffectAudienceV1["type"])}><option value="everyone">Everyone</option><option value="gm">GM only</option><option value="players">Players</option><option value="detector-owner">Detector owner</option><option value="carrier-owner">Carrier owner</option><option value="target-owner">Target owner</option><option value="specific-users">Specific users</option></select></label>
    <label><Label>Color</Label><input type="color" value={effect.color} onChange={(event) => onChange((value) => ({ ...value, color: event.target.value }))} /></label>
    <label><Label>Maximum intensity</Label><input type="range" min="0" max="2" step="0.05" value={effect.maxIntensity} onChange={(event) => onChange((value) => ({ ...value, maxIntensity: Number(event.target.value) }))} /><output>{effect.maxIntensity.toFixed(2)}</output></label>
    <label><Label>Edge softness</Label><input type="range" min="0.05" max="4" step="0.05" value={effect.spread} onChange={(event) => onChange((value) => ({ ...value, spread: Number(event.target.value) }))} /><output>{effect.spread.toFixed(2)}</output></label>
    {effect.preset === "beam" && <label><Label>Beam width (°)</Label><input type="range" min="5" max="120" step="1" value={effect.beamWidth ?? 38} onChange={(event) => onChange((value) => ({ ...value, beamWidth: Number(event.target.value) }))} /><output>{effect.beamWidth ?? 38}°</output></label>}
    <label><Label>X offset (%)</Label><input type="number" min="-100" max="100" step="1" value={geometry.offsetX} onChange={(event) => setGeometry("offsetX", Number(event.target.value))} /></label>
    <label><Label>Y offset (%)</Label><input type="number" min="-100" max="100" step="1" value={geometry.offsetY} onChange={(event) => setGeometry("offsetY", Number(event.target.value))} /></label>
    <label><Label>{effect.preset === "beam" ? "Beam start (%)" : "Inner radius (%)"}</Label><input type="number" min="0" max="199" step="1" value={geometry.innerRadius} onChange={(event) => setGeometry("innerRadius", Number(event.target.value))} /></label>
    <label><Label>{effect.preset === "beam" ? "Beam length (%)" : "Outer radius (%)"}</Label><input type="number" min="1" max="200" step="1" value={geometry.outerRadius} onChange={(event) => setGeometry("outerRadius", Number(event.target.value))} /></label>
    <p className="field-hint">100% reaches the target edge. Use close radii and low edge softness for a crisp ring; separate the radii and raise softness for a broad glow.</p>
    <details className="animation-section wide" open={animationOpen} onToggle={(event) => setAnimationOpen(event.currentTarget.open)}><summary>Animation <small>{effect.animation?.mode ?? "none"}</small></summary><div className="animation-grid">
      <label><Label>Mode</Label><select value={effect.animation?.mode ?? "none"} onChange={(event) => setAnimation({ mode: event.target.value as NonNullable<ShaderEffectDefinitionV1["animation"]>["mode"] })}><option value="none">None</option><option value="pulse">Pulse</option><option value="flicker">Flicker</option></select></label>
      {(effect.animation?.mode ?? "none") !== "none" && <><label><Label>Rate</Label><input type="number" min="0" max="10" step="0.1" value={effect.animation?.rate ?? 1} onChange={(event) => setAnimation({ rate: Number(event.target.value) })} /></label><label><Label>Depth</Label><input type="range" min="0" max="1" step="0.05" value={effect.animation?.depth ?? 0.35} onChange={(event) => setAnimation({ depth: Number(event.target.value) })} /><output>{(effect.animation?.depth ?? 0.35).toFixed(2)}</output></label></>}
    </div></details>
  </div>{effect.audience.type === "specific-users" && <fieldset><legend>Specific users</legend>{party.length ? party.map((player) => <label className="user-check" key={player.id}><input type="checkbox" checked={effect.audience.type === "specific-users" && effect.audience.userIds.includes(player.id)} onChange={(event) => onChange((value) => { const audience = value.audience.type === "specific-users" ? value.audience : { type: "specific-users" as const, userIds: [] }; return { ...value, audience: { ...audience, userIds: event.target.checked ? [...audience.userIds, player.id] : audience.userIds.filter((id) => id !== player.id) } }; })} />{player.name} <small>{player.role}</small></label>) : <p className="muted">No connected users. Stored offline IDs are retained.</p>}</fieldset>}<button className="danger text-button" onClick={onDelete}>Delete effect</button></div>;
}

function DebugView({ rules }: { rules: DebugRuleState[] }) {
  return <section className="content-card debug-view"><h2>Local runtime</h2><p className="muted">Derived state from this client only. Nothing here is stored in scene metadata.</p>{rules.length === 0 ? <div className="notice">No active detector rules.</div> : rules.map((rule) => <article key={`${rule.detectorId}:${rule.ruleId}`}><h3>{rule.detectorName}</h3><code>{rule.signal} · {rule.range.outer}</code><dl className="facts"><div><dt>Matches</dt><dd>{rule.matchingEmitterCount}</dd></div><div><dt>Nearest</dt><dd>{rule.emitterName ?? "None"}</dd></div><div><dt>Distance</dt><dd>{rule.distance?.toFixed(2) ?? "—"}</dd></div><div><dt>Strength</dt><dd>{rule.strength.toFixed(3)}</dd></div></dl>{rule.effects.map((effect) => <div className="debug-effect" key={effect.effectId}><strong>{effect.providerId ? `${effect.providerId} · ${effect.actionId}` : effect.type} · {effect.lifecycle}</strong><span>{effect.transition} · {effect.targetType} → {effect.targetName ?? "unresolved"}</span><span>{effect.audience} · {effect.audienceMatch ? "execution client" : "not executing here"}</span><code>{effect.executionStatus ?? effect.localItemId ?? "inactive"}</code></div>)}</article>)}</section>;
}
