import OBR, { isImage, type GridType, type Item, type Player } from "@owlbear-rodeo/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DETECTOR_KEY, EFFECT_LIBRARY_STORAGE_KEY, EMANATION_INTEGRATION_KEY, EMITTER_KEY, EXTENSION_NAME, SETTINGS_KEY } from "./constants";
import { parseDetectorMetadata, parseEmitterMetadata } from "./metadata/parse";
import { DEBUG_STORAGE_KEY } from "./runtime/engine";
import { DEFAULT_GEOMETRY, resolveShaderGeometry } from "./effects/shader/geometry";
import { createIntegrationEffect, INTEGRATION_CATALOG } from "./effects/integrations/catalog";
import { IntegrationEffectEditor } from "./effects/integrations/ui/IntegrationEffectEditor";
import { instantiateLibraryEffect, loadEffectLibrary, type EffectLibraryEntryV1, type EffectLibraryV1 } from "./effects/library";
import { normalizeSignal } from "./signals/normalize";
import type { DebugRuleState, DetectionRuleV1, DetectorMetadataV1, EffectAudienceV1, EffectDefinitionV1, EffectTargetV1, EmitterMetadataV1, MechanicalEffectDefinitionV1, ShaderEffectDefinitionV1 } from "./types";
import { StatusPanel } from "./components/StatusPanel";
import { useOwlbear } from "./hooks/useOwlbear";
import { DEFAULT_SCENE_SETTINGS, isDistanceMethodValidForGrid, isHexGrid, parseSceneSettings, type SceneSettingsV1 } from "./settings";
import { SliderNumber } from "./components/SliderNumber";

const newEffect = (): ShaderEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" }, preset: "glow", shape: "circle", placement: "above", color: "#55aaff", maxIntensity: 1, spread: 1.25, animation: { mode: "none", rate: 1, depth: 0.35 } });
const newFaceEffect = (): MechanicalEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "mechanical", enabled: true, action: "face", target: { type: "detector" }, faceAngle: 0, pivotX: 0, pivotY: 0, speed: 180 });
const newVisibilityEffect = (): MechanicalEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "mechanical", enabled: true, action: "visibility", target: { type: "detector" }, visibility: "hidden", reverseOnExit: true });
const newRule = (): DetectionRuleV1 => ({ id: crypto.randomUUID(), enabled: true, signal: "signal", aggregation: "nearest", ignoreHidden: false, range: { outer: 60, inner: 5 }, falloff: "smoothstep", effects: [newEffect()] });
const Label = ({ children, tooltip }: { children: React.ReactNode; tooltip?: string }) => <span className="field-label" title={tooltip}>{children}</span>;
const Icon = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
const BugIcon = () => <Icon><path d="M8 8h8v9a4 4 0 0 1-8 0V8Zm2-3h4l1 3H9l1-3ZM5 11h3m8 0h3M5 16h3m8 0h3M7 7 5 5m12 2 2-2" /></Icon>;
const GearIcon = () => <Icon><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5 1 2.2 2.4.6 2-1.2 2 2-1.2 2 .6 2.4L21 12l-2.2 1-.6 2.4 1.2 2-2 2-2-1.2-2.4.6L12 21l-1-2.2-2.4-.6-2 1.2-2-2 1.2-2-.6-2.4L3 12l2.2-1 .6-2.4-1.2-2 2-2 2 1.2 2.4-.6L12 3Z" /></Icon>;
const BookIcon = () => <Icon><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z" /></Icon>;
const TrashIcon = () => <Icon><path d="M4 7h16M9 3h6l1 4H8l1-4Zm-3 4 1 14h10l1-14M10 11v6m4-6v6" /></Icon>;
const SaveIcon = () => <Icon><path d="M5 3h12l2 2v16H5V3Zm3 0v6h8V3M8 21v-8h8v8" /></Icon>;
const effectTypeLabel = (effect: EffectDefinitionV1) => effect.type === "shader" ? effect.preset : effect.type === "mechanical" ? effect.action === "face" ? "Face" : "Hide/Show" : INTEGRATION_CATALOG.find((provider) => provider.id === effect.providerId)?.displayName ?? effect.providerId;
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
  const [showSettings, setShowSettings] = useState(true);
  const [gridUnit, setGridUnit] = useState("");
  const [emanationEnabled, setEmanationEnabled] = useState(() => localStorage.getItem(EMANATION_INTEGRATION_KEY) === "true");
  const [sceneSettings, setSceneSettings] = useState<SceneSettingsV1>(DEFAULT_SCENE_SETTINGS);
  const [gridType, setGridType] = useState<GridType>("SQUARE");
  const [effectLibrary, setEffectLibrary] = useState<EffectLibraryV1>(() => loadEffectLibrary(localStorage, EFFECT_LIBRARY_STORAGE_KEY));
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const hydratedItemId = useRef<string | null>(null);
  const lastSavedSignature = useRef("");
  const selectionSignature = useRef("");
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const displayedDistanceMethod = isDistanceMethodValidForGrid(sceneSettings.distanceMethod, gridType) ? sceneSettings.distanceMethod : "scene";
  const sceneSignals = useMemo(() => [...new Set(items.flatMap((item) => parseEmitterMetadata(item.metadata[EMITTER_KEY])?.signals ?? []))].sort(), [items]);

  const loadSelection = useCallback(async (nextItems?: Item[]) => {
    const allItems = nextItems ?? await OBR.scene.items.getItems();
    setItems(allItems);
    const selection = await OBR.player.getSelection();
    const nextSelectedId = selection?.length === 1 ? selection[0] : null;
    const nextSignature = selection?.length === 1 ? `one:${selection[0]}` : `count:${selection?.length ?? 0}`;
    if (selectionSignature.current !== nextSignature) {
      selectionSignature.current = nextSignature;
      setShowSettings(nextSelectedId === null);
      setShowDebug(false);
    }
    setSelectedId(nextSelectedId);
  }, []);

  useEffect(() => {
    if (connection.status !== "ready" || !connection.sceneReady) return;
    void loadSelection();
    void OBR.party.getPlayers().then(setParty);
    void Promise.all([OBR.scene.grid.getScale(), OBR.scene.grid.getType()]).then(([scale, type]) => { setGridUnit(scale.parsed.unit); setGridType(type); });
    const stopItems = OBR.scene.items.onChange((next) => void loadSelection(next));
    const stopPlayer = OBR.player.onChange(() => void loadSelection());
    const stopParty = OBR.party.onChange(setParty);
    const stopGrid = OBR.scene.grid.onChange((grid) => { setGridType(grid.type); void OBR.scene.grid.getScale().then((scale) => setGridUnit(scale.parsed.unit)); });
    return () => { stopItems(); stopPlayer(); stopParty(); stopGrid(); };
  }, [connection.sceneReady, connection.status, loadSelection]);

  useEffect(() => {
    if (connection.status !== "ready" || !connection.sceneReady) {
      setSceneSettings(DEFAULT_SCENE_SETTINGS);
      return;
    }
    const applySettings = (metadata: Awaited<ReturnType<typeof OBR.scene.getMetadata>>) => setSceneSettings(parseSceneSettings(metadata[SETTINGS_KEY]));
    void OBR.scene.getMetadata().then(applySettings);
    const stopSettings = OBR.scene.onMetadataChange(applySettings);
    return stopSettings;
  }, [connection.sceneReady, connection.status]);

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
  const updateDistanceMethod = (distanceMethod: SceneSettingsV1["distanceMethod"]) => {
    const next: SceneSettingsV1 = { version: 1, distanceMethod };
    setSceneSettings(next);
    setSettingsError(null);
    void OBR.scene.setMetadata({ [SETTINGS_KEY]: next }).catch(() => {
      setSettingsError("Unable to save scene settings.");
      void OBR.scene.getMetadata().then((metadata) => setSceneSettings(parseSceneSettings(metadata[SETTINGS_KEY])));
    });
  };
  const saveLibrary = (next: EffectLibraryV1) => {
    try {
      localStorage.setItem(EFFECT_LIBRARY_STORAGE_KEY, JSON.stringify(next));
      setEffectLibrary(next);
      setSettingsError(null);
    } catch {
      setSettingsError("Unable to save the effects library in this browser.");
    }
  };
  const saveEffectToLibrary = (effect: EffectDefinitionV1) => {
    const suggested = effect.type === "shader" ? effect.preset === "beam" ? "Directional beam" : "Glow" : effect.type === "mechanical" ? effect.action === "face" ? "Face" : "Hide/Show" : INTEGRATION_CATALOG.find((provider) => provider.id === effect.providerId)?.displayName ?? "Integration effect";
    const name = window.prompt("Name this library effect", suggested)?.trim();
    if (!name) return;
    const entry: EffectLibraryEntryV1 = { id: crypto.randomUUID(), name: name.slice(0, 80), effect: structuredClone(effect) };
    saveLibrary({ version: 1, entries: [...effectLibrary.entries, entry] });
  };
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

  const extensionRoot = new URL("./", window.location.href).href;
  return <main className="app-shell">
    <header className="app-header"><div className="brand"><img src="./icon.svg" alt="" /><h1>{EXTENSION_NAME}</h1></div><nav className="header-actions" aria-label="Extension views"><button className={`icon-button${showDebug ? " active" : ""}`} title="Debug runtime" aria-label="Debug runtime" onClick={() => { setShowDebug((value) => !value); setShowSettings(false); }}><BugIcon /></button><button className={`icon-button${showSettings ? " active" : ""}`} title="Settings" aria-label="Settings" onClick={() => { setShowSettings((value) => !value); setShowDebug(false); }}><GearIcon /></button><a className="icon-button" href={extensionRoot} target="_blank" rel="noreferrer" title="Open Sting help" aria-label="Open Sting help">?</a></nav></header>
    {!connection.sceneReady && <div className="notice">Open a scene to configure proximity signals.</div>}
    {connection.sceneReady && connection.role !== "GM" && <div className="notice">The runtime is active. Only the GM can configure scene items.</div>}
    {connection.sceneReady && connection.role === "GM" && !selected && <div className="notice">Select exactly one scene item to configure it.</div>}
    {connection.status === "ready" && showSettings && <section className="content-card settings-section"><div className="section-title"><div><h2>Settings</h2><p className="muted">Distance settings for this scene</p></div></div>
      <div className="settings-content">
        <label title="Choose how Sting measures ranges and determines which signal is closest."><Label tooltip="Choose how Sting measures ranges and determines which signal is closest.">Distance calculation</Label><select title="Choose the distance calculation method for this scene." value={displayedDistanceMethod} disabled={connection.role !== "GM" || !connection.sceneReady} onChange={(event) => updateDistanceMethod(event.target.value as SceneSettingsV1["distanceMethod"])}><option value="scene">Use scene measurement type</option>{isHexGrid(gridType) ? <><option value="hexagon">Hexagon</option><option value="euclidean">Euclidean</option></> : <><option value="chessboard">Chessboard (D&amp;D 5e)</option><option value="alternating">Alternating Diagonal (D&amp;D 3.5e)</option><option value="euclidean">Euclidean</option><option value="manhattan">Manhattan</option></>}</select></label>
        <p className="muted">Controls signal range, falloff, and which signal is considered closest.</p>
        <div className="settings-subsection"><div className="section-title"><strong>Effects Library</strong><span className="library-count">{effectLibrary.entries.length}</span></div>{effectLibrary.entries.length ? <div className="library-list">{effectLibrary.entries.map((entry) => <div className="library-row" key={entry.id}><span><strong>{entry.name}</strong><small>{effectTypeLabel(entry.effect)}</small></span><button className="mini-icon danger" title={`Delete ${entry.name} from the effects library.`} aria-label={`Delete ${entry.name} from the effects library`} onClick={() => saveLibrary({ version: 1, entries: effectLibrary.entries.filter((candidate) => candidate.id !== entry.id) })}><TrashIcon /></button></div>)}</div> : <p className="muted library-empty">Save an effect to reuse it later in this browser.</p>}</div>
        <div className="settings-subsection"><strong>Extensions</strong><div className="extension-row"><div><strong>Auras &amp; Emanations</strong><p className="muted">Trigger named presets through the installed extension.</p></div><label className="toggle" title="Allow Sting rules to execute Auras &amp; Emanations actions."><input type="checkbox" checked={emanationEnabled} disabled={connection.role !== "GM"} onChange={(event) => toggleEmanation(event.target.checked)} /> Enabled</label></div></div>
        {settingsError && <div className="validation-error" role="alert">{settingsError}</div>}
      </div>
    </section>}
    {showDebug ? <DebugView rules={debug} /> : selected && !showSettings && connection.role === "GM" ? <>
      <section className="item-heading"><div className="selected-thumbnail">{isImage(selected) && selected.image.mime.startsWith("image/") ? <img src={selected.image.url} alt="" /> : <span aria-hidden="true">◇</span>}</div><div><span className="eyebrow">Selected item</span><h2>{selected.name || "Unnamed item"}</h2><code>{selected.id}</code></div></section>
      <section className="content-card"><h2 title="Add text tags to this item that can be detected by detector items.">Emitter</h2><div className="chips">{emitter.signals.map((signal) => <button title={`Remove the ${signal} signal from this item.`} key={signal} className="chip" onClick={() => setEmitter({ version: 1, signals: emitter.signals.filter((value) => value !== signal) })}>{signal}<span>×</span></button>)}</div><div className="input-row"><input title="Signal tag this item advertises." list="scene-signals" value={signalDraft} placeholder="Add signal…" onChange={(event) => setSignalDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSignal(); } }} /><button title="Add this signal to the selected item." onClick={addSignal}>Add</button></div><datalist id="scene-signals">{sceneSignals.map((signal) => <option key={signal} value={signal} />)}</datalist></section>
      <section className="content-card"><div className="section-title"><h2 title="Add detection rules that respond when matching emitter tags are within range.">Detector</h2><label className="toggle" title="Enable or disable every detection rule on this item."><input type="checkbox" checked={detector.enabled} onChange={(event) => setDetector({ ...detector, enabled: event.target.checked })} /> Enabled</label></div>{detector.rules.map((rule, ruleIndex) => <RuleEditor key={rule.id} rule={rule} index={ruleIndex} unit={gridUnit} items={items} party={party} emanationEnabled={emanationEnabled} library={effectLibrary.entries} onSaveEffect={saveEffectToLibrary} onChange={(update) => updateRule(ruleIndex, update)} onEffect={(effectIndex, update) => updateEffect(ruleIndex, effectIndex, update)} onDelete={() => setDetector({ ...detector, rules: detector.rules.filter((_, i) => i !== ruleIndex) })} />)}<button className="wide-button" title="Add another detection rule to this item." onClick={() => setDetector({ ...detector, rules: [...detector.rules, newRule()] })}>+ Add detection rule</button></section>
      {saveError && <div className="validation-error" role="alert">{saveError}</div>}<div className="autosave-status" role="status">{autosaveStatus === "saving" ? "Saving…" : autosaveStatus === "error" ? "Not saved" : "Saved automatically"}</div>
    </> : null}
  </main>;
}

interface RuleEditorProps { rule: DetectionRuleV1; index: number; unit: string; items: Item[]; party: Player[]; emanationEnabled: boolean; library: EffectLibraryEntryV1[]; onSaveEffect: (effect: EffectDefinitionV1) => void; onChange: (update: (rule: DetectionRuleV1) => DetectionRuleV1) => void; onEffect: (index: number, update: (effect: EffectDefinitionV1) => EffectDefinitionV1) => void; onDelete: () => void; }
function RuleEditor({ rule, index, unit, items, party, emanationEnabled, library, onSaveEffect, onChange, onEffect, onDelete }: RuleEditorProps) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const enabledProviders = INTEGRATION_CATALOG.filter((provider) => provider.id !== "auras-emanations" || emanationEnabled);
  return <article className="rule-card"><div className="section-title"><h3>Rule {index + 1}</h3><div className="rule-header-actions"><label className="toggle" title="Enable or disable this detection rule."><input type="checkbox" checked={rule.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /> Active</label><button className="mini-icon danger" title="Delete this detection rule." aria-label={`Delete rule ${index + 1}`} onClick={onDelete}><TrashIcon /></button></div></div><div className="form-grid">
    <label title="Signal tag this rule listens for."><Label tooltip="Signal tag this rule listens for.">Signal</Label><input value={rule.signal} onChange={(event) => onChange((value) => ({ ...value, signal: event.target.value }))} /></label>
    <label title="How effect strength changes between the full-strength and outer ranges."><Label tooltip="How effect strength changes between the full-strength and outer ranges.">Falloff</Label><select value={rule.falloff} onChange={(event) => onChange((value) => ({ ...value, falloff: event.target.value as DetectionRuleV1["falloff"] }))}><option value="smoothstep">Smooth</option><option value="linear">Linear</option><option value="binary">Binary</option></select></label>
    <label title="Choose the closest matching emitter or every matching emitter in range."><Label tooltip="Choose the closest matching emitter or every matching emitter in range.">Detection mode</Label><select value={rule.aggregation} onChange={(event) => onChange((value) => ({ ...value, aggregation: event.target.value as DetectionRuleV1["aggregation"] }))}><option value="nearest">Closest signal</option><option value="all">All signals in range</option></select></label>
    <label className="checkbox-field" title="Exclude hidden emitters from this rule's detection results."><Label tooltip="Exclude hidden emitters from this rule's detection results.">Ignore hidden items</Label><span className="toggle"><input type="checkbox" checked={rule.ignoreHidden} onChange={(event) => onChange((value) => ({ ...value, ignoreHidden: event.target.checked }))} /> Ignore</span></label>
    <SliderNumber tooltip="Maximum detection distance." label={`Outer range${unit ? ` (${unit})` : ""}`} min={0.5} step={0.5} value={rule.range.outer} suffix={unit ? ` ${unit}` : ""} onChange={(outer) => onChange((value) => ({ ...value, range: { inner: Math.min(value.range.inner, Math.max(0, outer - 0.5)), outer } }))} />
    <SliderNumber tooltip="Distance at or below which effects use full strength." label={`Full strength at${unit ? ` (${unit})` : ""}`} min={0} max={Math.max(0, rule.range.outer - 0.5)} step={0.5} value={rule.range.inner} suffix={unit ? ` ${unit}` : ""} onChange={(inner) => onChange((value) => ({ ...value, range: { ...value.range, inner } }))} />
  </div><div className="effects-heading"><h4>Effects <span>{rule.effects.length}</span></h4><div className="effect-add-actions" aria-label="Add effect"><button className="effect-glyph" title="Add a native shader effect." aria-label="Add a native shader effect" onClick={() => onChange((value) => ({ ...value, effects: [...value.effects, newEffect()] }))}><img src="./icon.svg" alt="" /></button><button className="effect-glyph" title="Add a mechanical effect." aria-label="Add a mechanical effect" onClick={() => onChange((value) => ({ ...value, effects: [...value.effects, newFaceEffect()] }))}><GearIcon /></button><button className={`effect-glyph${libraryOpen ? " active" : ""}`} title={library.length ? "Add an effect from your browser-local library." : "Your browser-local effects library is empty."} aria-label="Add an effect from the effects library" disabled={!library.length} onClick={() => setLibraryOpen((value) => !value)}><BookIcon /></button>{enabledProviders.map((provider) => <button className="effect-glyph" key={provider.id} title={`Add ${provider.displayName} effect.`} aria-label={`Add ${provider.displayName} effect`} onClick={() => onChange((value) => ({ ...value, effects: [...value.effects, createIntegrationEffect(provider.id, provider.actions[0].id)] }))}><img src={provider.iconUrl} alt="" /></button>)}</div></div>{libraryOpen && <div className="library-picker">{library.map((entry) => <button key={entry.id} title={`Add ${entry.name} to this rule.`} onClick={() => { onChange((value) => ({ ...value, effects: [...value.effects, instantiateLibraryEffect(entry)] })); setLibraryOpen(false); }}><span>{entry.name}</span><small>{effectTypeLabel(entry.effect)}</small></button>)}</div>}{rule.effects.map((effect, effectIndex) => effect.type === "shader" ? <EffectEditor key={effect.id} effect={effect} items={items} party={party} onSave={() => onSaveEffect(effect)} onChange={(update) => onEffect(effectIndex, (current) => current.type === "shader" ? update(current) : current)} onDelete={() => onChange((value) => ({ ...value, effects: value.effects.filter((_, i) => i !== effectIndex) }))} /> : effect.type === "mechanical" ? <MechanicalEffectEditor key={effect.id} effect={effect} items={items} onSave={() => onSaveEffect(effect)} onChange={(update) => onEffect(effectIndex, (current) => current.type === "mechanical" ? update(current) : current)} onDelete={() => onChange((value) => ({ ...value, effects: value.effects.filter((_, i) => i !== effectIndex) }))} /> : <IntegrationEffectEditor key={effect.id} effect={effect} items={items} providerEnabled={emanationEnabled} onSave={() => onSaveEffect(effect)} onChange={(update) => onEffect(effectIndex, (current) => current.type === "integration" ? update(current) : current)} onDelete={() => onChange((value) => ({ ...value, effects: value.effects.filter((_, i) => i !== effectIndex) }))} />)}</article>;
}

function MechanicalEffectEditor({ effect, items, onSave, onChange, onDelete }: { effect: MechanicalEffectDefinitionV1; items: Item[]; onSave: () => void; onChange: (update: (effect: MechanicalEffectDefinitionV1) => MechanicalEffectDefinitionV1) => void; onDelete: () => void }) {
  const switchAction = (action: MechanicalEffectDefinitionV1["action"]) => onChange((current) => action === "face"
    ? { ...newFaceEffect(), id: current.id, enabled: current.enabled, target: current.target }
    : { ...newVisibilityEffect(), id: current.id, enabled: current.enabled, target: current.target });
  if (effect.action === "visibility") return <VisibilityEffectEditor effect={effect} items={items} onSave={onSave} onActionChange={switchAction} onChange={(update) => onChange((current) => current.action === "visibility" ? update(current) : current)} onDelete={onDelete} />;
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  return <div className="effect-card"><div className="section-title"><strong>Face</strong><div className="effect-header-actions"><button className="mini-icon" title="Save this effect to your browser-local library." aria-label="Save effect to library" onClick={onSave}><SaveIcon /></button><label className="toggle"><input type="checkbox" checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /> Enabled</label></div></div><div className="form-grid">
    <label className="wide" title="Choose the shared scene behavior this mechanical effect applies."><Label tooltip="Choose the shared scene behavior this mechanical effect applies.">Action</Label><select value={effect.action} onChange={(event) => switchAction(event.target.value as MechanicalEffectDefinitionV1["action"])}><option value="face">Face closest emitter</option><option value="visibility">Hide/Show</option></select></label>
    <label className="wide" title="Scene item that rotates to face the closest emitter."><Label tooltip="Scene item that rotates to face the closest emitter.">Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Detector</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter</option><option value="specific-item">Specific item</option></select></label>
    {effect.target.type === "specific-item" && <label className="wide" title="Exact scene item to rotate."><Label tooltip="Exact scene item to rotate.">Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
    <SliderNumber className="wide" tooltip="Direction the artwork faces at zero token rotation; 0° is north/up." label="Face" min={0} max={359} step={1} value={effect.faceAngle} suffix="°" onChange={(faceAngle) => onChange((value) => ({ ...value, faceAngle }))} />
    <div className="paired-controls wide"><SliderNumber tooltip="Horizontal pivot offset from the item center; ±100% reaches the current bounds edge." label="Pivot X" min={-500} max={500} step={5} inputStep={1} value={effect.pivotX} suffix="%" onChange={(pivotX) => onChange((value) => ({ ...value, pivotX }))} /><SliderNumber tooltip="Vertical pivot offset from the item center; ±100% reaches the current bounds edge." label="Pivot Y" min={-500} max={500} step={5} inputStep={1} value={effect.pivotY} suffix="%" onChange={(pivotY) => onChange((value) => ({ ...value, pivotY }))} /></div>
    <SliderNumber className="wide" tooltip="Constant angular turning speed." label="Speed" min={15} max={720} step={15} value={effect.speed} suffix="°/s" onChange={(speed) => onChange((value) => ({ ...value, speed }))} />
  </div><button className="danger text-button" onClick={onDelete}>Delete effect</button></div>;
}

function VisibilityEffectEditor({ effect, items, onSave, onActionChange, onChange, onDelete }: { effect: Extract<MechanicalEffectDefinitionV1, { action: "visibility" }>; items: Item[]; onSave: () => void; onActionChange: (action: MechanicalEffectDefinitionV1["action"]) => void; onChange: (update: (effect: Extract<MechanicalEffectDefinitionV1, { action: "visibility" }>) => Extract<MechanicalEffectDefinitionV1, { action: "visibility" }>) => void; onDelete: () => void }) {
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  return <div className="effect-card"><div className="section-title"><strong>Hide/Show</strong><div className="effect-header-actions"><button className="mini-icon" title="Save this effect to your browser-local library." aria-label="Save effect to library" onClick={onSave}><SaveIcon /></button><label className="toggle"><input type="checkbox" checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /> Enabled</label></div></div><div className="form-grid">
    <label className="wide" title="Choose the shared scene behavior this mechanical effect applies."><Label tooltip="Choose the shared scene behavior this mechanical effect applies.">Action</Label><select value={effect.action} onChange={(event) => onActionChange(event.target.value as MechanicalEffectDefinitionV1["action"])}><option value="face">Face closest emitter</option><option value="visibility">Hide/Show</option></select></label>
    <label className="wide" title="Scene item whose visibility changes when the threshold is crossed."><Label tooltip="Scene item whose visibility changes when the threshold is crossed.">Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Detector</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter</option><option value="specific-item">Specific item</option></select></label>
    {effect.target.type === "specific-item" && <label className="wide" title="Exact scene item whose visibility changes."><Label tooltip="Exact scene item whose visibility changes.">Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
    <label className="wide" title="Visibility to apply when a matching emitter crosses into range."><Label tooltip="Visibility to apply when a matching emitter crosses into range.">On threshold entry</Label><select value={effect.visibility} onChange={(event) => onChange((value) => ({ ...value, visibility: event.target.value as "hidden" | "shown" }))}><option value="hidden">Become hidden</option><option value="shown">Become shown</option></select></label>
    <label className="toggle wide" title="Apply the opposite visibility when the final matching emitter crosses back out of range."><input type="checkbox" checked={effect.reverseOnExit} onChange={(event) => onChange((value) => ({ ...value, reverseOnExit: event.target.checked }))} /> Reverse on threshold exit</label>
  </div><button className="danger text-button" onClick={onDelete}>Delete effect</button></div>;
}

function EffectEditor({ effect, items, party, onSave, onChange, onDelete }: { effect: ShaderEffectDefinitionV1; items: Item[]; party: Player[]; onSave: () => void; onChange: (update: (effect: ShaderEffectDefinitionV1) => ShaderEffectDefinitionV1) => void; onDelete: () => void }) {
  const [animationOpen, setAnimationOpen] = useState(effect.animation?.mode !== "none" && effect.animation !== undefined);
  const geometry = resolveShaderGeometry(effect);
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  const setAudience = (type: EffectAudienceV1["type"]) => onChange((value) => ({ ...value, audience: type === "specific-users" ? { type, userIds: [] } : { type } }));
  const setGeometry = (field: keyof typeof geometry, value: number) => onChange((current) => ({ ...current, geometry: { ...resolveShaderGeometry(current), [field]: value } }));
  const setAnimation = (update: Partial<NonNullable<ShaderEffectDefinitionV1["animation"]>>) => onChange((current) => ({ ...current, animation: { mode: "none", rate: 1, depth: 0.35, radialDirection: "outward", waveWidth: 0.22, ...current.animation, ...update } }));
  return <div className="effect-card"><div className="section-title"><strong>{effect.preset[0].toUpperCase() + effect.preset.slice(1)}</strong><div className="effect-header-actions"><button className="mini-icon" title="Save this effect to your browser-local library." aria-label="Save effect to library" onClick={onSave}><SaveIcon /></button><label className="toggle"><input type="checkbox" checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /> Enabled</label></div></div><div className="form-grid">
    <div className="paired-controls wide"><label title="Choose the native visual treatment."><Label tooltip="Choose the native visual treatment.">Preset</Label><select value={effect.preset} onChange={(event) => onChange((value) => { const preset = event.target.value as ShaderEffectDefinitionV1["preset"]; return { ...value, preset, geometry: DEFAULT_GEOMETRY[preset] }; })}><option value="glow">Glow</option><option value="beam">Directional beam</option></select></label><label title="Choose the shader boundary shape."><Label tooltip="Choose the shader boundary shape.">Shape</Label><select value={effect.shape} onChange={(event) => onChange((value) => ({ ...value, shape: event.target.value as ShaderEffectDefinitionV1["shape"] }))}><option value="circle">Circle</option><option value="square">Square</option></select></label></div>
    <label className="wide" title="Draw the shader immediately above or below its target on the same scene layer."><Label tooltip="Draw the shader immediately above or below its target on the same scene layer.">Placement</Label><select value={effect.placement} onChange={(event) => onChange((value) => ({ ...value, placement: event.target.value as ShaderEffectDefinitionV1["placement"] }))}><option value="above">Above target</option><option value="below">Below target</option></select></label>
    <div className="paired-controls wide"><label title="Scene item that receives the effect."><Label tooltip="Scene item that receives the effect.">Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Detector</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter</option><option value="specific-item">Specific item</option></select></label><label title="Players who can see this effect."><Label tooltip="Players who can see this effect.">Audience</Label><select value={effect.audience.type} onChange={(event) => setAudience(event.target.value as EffectAudienceV1["type"])}><option value="everyone">Everyone</option><option value="gm">GM only</option><option value="players">Players</option><option value="detector-owner">Detector owner</option><option value="carrier-owner">Carrier owner</option><option value="target-owner">Target owner</option><option value="specific-users">Specific users</option></select></label></div>
    {effect.target.type === "specific-item" && <label className="wide" title="Exact scene item to target."><Label tooltip="Exact scene item to target.">Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
    <label title="Effect color."><Label tooltip="Effect color.">Color</Label><input type="color" value={effect.color} onChange={(event) => onChange((value) => ({ ...value, color: event.target.value }))} /></label>
    <SliderNumber tooltip="Maximum opacity and strength at full detection." label="Maximum intensity" min={0} max={2} step={0.05} decimals={2} value={effect.maxIntensity} onChange={(maxIntensity) => onChange((value) => ({ ...value, maxIntensity }))} />
    <SliderNumber tooltip="Feathering at the inner and outer edges." label="Edge softness" min={0.05} max={4} step={0.05} decimals={2} value={effect.spread} onChange={(spread) => onChange((value) => ({ ...value, spread }))} />
    {effect.preset === "beam" && <SliderNumber tooltip="Angular width of the directional beam." label="Beam width" min={5} max={120} step={1} value={effect.beamWidth ?? 38} suffix="°" onChange={(beamWidth) => onChange((value) => ({ ...value, beamWidth }))} />}
    <div className="paired-controls wide"><SliderNumber tooltip="Horizontal scale of the effect; 100% matches the target width." label="Width" min={5} max={400} step={1} value={geometry.width} suffix="%" onChange={(value) => setGeometry("width", value)} /><SliderNumber tooltip="Vertical scale of the effect; 100% matches the target height." label="Height" min={5} max={400} step={1} value={geometry.height} suffix="%" onChange={(value) => setGeometry("height", value)} /></div>
    <SliderNumber tooltip={effect.preset === "beam" ? "Rotation offset from the automatically detected direction." : "Clockwise rotation of the effect's local axes."} label="Rotation" min={-180} max={180} step={1} value={geometry.rotation} suffix="°" onChange={(value) => setGeometry("rotation", value)} />
    <div className="paired-controls wide"><SliderNumber tooltip="Move the effect center horizontally as a percentage of target size." label="X offset" min={-100} max={100} step={1} value={geometry.offsetX} suffix="%" onChange={(value) => setGeometry("offsetX", value)} /><SliderNumber tooltip="Move the effect center vertically as a percentage of target size." label="Y offset" min={-100} max={100} step={1} value={geometry.offsetY} suffix="%" onChange={(value) => setGeometry("offsetY", value)} /></div>
    {effect.preset === "beam" ? <div className="paired-controls wide"><SliderNumber tooltip="Radial distance where the beam begins; 100% is the target edge." label="Beam start" min={0} max={Math.max(0, geometry.outerRadius - 1)} step={1} value={geometry.innerRadius} suffix="%" onChange={(value) => setGeometry("innerRadius", value)} /><SliderNumber tooltip="Radial distance where the beam ends; 100% is the target edge." label="Beam end" min={geometry.innerRadius + 1} max={200} step={1} value={geometry.outerRadius} suffix="%" onChange={(value) => setGeometry("outerRadius", value)} /></div> : <><SliderNumber tooltip="Inner edge of the glow; 100% is the target edge." label="Inner radius" min={0} max={Math.max(0, geometry.outerRadius - 1)} step={1} value={geometry.innerRadius} suffix="%" onChange={(value) => setGeometry("innerRadius", value)} /><SliderNumber tooltip="Outer edge of the glow; 100% is the target edge." label="Outer radius" min={geometry.innerRadius + 1} max={200} step={1} value={geometry.outerRadius} suffix="%" onChange={(value) => setGeometry("outerRadius", value)} /></>}
    <details className="animation-section wide" open={animationOpen} onToggle={(event) => setAnimationOpen(event.currentTarget.open)}><summary>Animation <small>{effect.animation?.mode ?? "none"}</small></summary><div className="animation-grid">
      <label title="Choose how effect intensity changes over time."><Label tooltip="Choose how effect intensity changes over time.">Mode</Label><select value={effect.animation?.mode ?? "none"} onChange={(event) => setAnimation({ mode: event.target.value as NonNullable<ShaderEffectDefinitionV1["animation"]>["mode"] })}><option value="none">None</option><option value="pulse">Pulse</option><option value="flicker">Flicker</option><option value="radial-pulse">Radial pulse</option></select></label>
      {(effect.animation?.mode ?? "none") !== "none" && <><SliderNumber tooltip="Animation cycles per second." label="Rate" min={0} max={10} step={0.1} decimals={1} value={effect.animation?.rate ?? 1} onChange={(rate) => setAnimation({ rate })} /><SliderNumber tooltip="Difference between the dim and bright animation phases." label="Depth" min={0} max={1} step={0.05} decimals={2} value={effect.animation?.depth ?? 0.35} onChange={(depth) => setAnimation({ depth })} /></>}
      {effect.animation?.mode === "radial-pulse" && <><label title="Direction the radial pulse travels."><Label tooltip="Direction the radial pulse travels.">Direction</Label><select value={effect.animation.radialDirection ?? "outward"} onChange={(event) => setAnimation({ radialDirection: event.target.value as "outward" | "inward" })}><option value="outward">Outward</option><option value="inward">Inward</option></select></label><SliderNumber tooltip="Thickness of the traveling radial band." label="Wave width" min={0.05} max={1} step={0.05} decimals={2} value={effect.animation.waveWidth ?? 0.22} onChange={(waveWidth) => setAnimation({ waveWidth })} /></>}
    </div></details>
  </div>{effect.audience.type === "specific-users" && <fieldset><legend>Specific users</legend>{party.length ? party.map((player) => <label className="user-check" key={player.id}><input type="checkbox" checked={effect.audience.type === "specific-users" && effect.audience.userIds.includes(player.id)} onChange={(event) => onChange((value) => { const audience = value.audience.type === "specific-users" ? value.audience : { type: "specific-users" as const, userIds: [] }; return { ...value, audience: { ...audience, userIds: event.target.checked ? [...audience.userIds, player.id] : audience.userIds.filter((id) => id !== player.id) } }; })} />{player.name} <small>{player.role}</small></label>) : <p className="muted">No connected users. Stored offline IDs are retained.</p>}</fieldset>}<button className="danger text-button" onClick={onDelete}>Delete effect</button></div>;
}

function DebugView({ rules }: { rules: DebugRuleState[] }) {
  return <section className="content-card debug-view"><h2>Local runtime</h2><p className="muted">Derived state from this client only. Nothing here is stored in scene metadata.</p>{rules.length === 0 ? <div className="notice">No active detector rules.</div> : rules.map((rule) => <article key={`${rule.detectorId}:${rule.ruleId}`}><h3>{rule.detectorName}</h3><code>{rule.signal} · {rule.aggregation === "all" ? "all in range" : "closest"} · {rule.range.outer}</code><dl className="facts"><div><dt>Matches</dt><dd>{rule.matchingEmitterCount}</dd></div><div><dt>Active</dt><dd>{rule.activeEmitterCount}</dd></div></dl>{rule.detections.map((detection, index) => <div className="debug-detection" key={`${detection.emitterName}:${index}`}><strong>{detection.emitterName}</strong><span>{detection.distance.toFixed(2)} · strength {detection.strength.toFixed(3)}</span></div>)}{rule.effects.map((effect, index) => <div className="debug-effect" key={`${effect.effectId}:${effect.runtimeKey ?? index}`}><strong>{effect.providerId ? `${effect.providerId} · ${effect.actionId}` : effect.actionId ? `${effect.type} · ${effect.actionId}` : effect.type} · {effect.lifecycle}</strong><span>{effect.transition} · {effect.targetType} → {effect.targetName ?? "unresolved"}</span><span>{effect.audience ?? "GM authority"} · {effect.audienceMatch ? "execution client" : "not executing here"}</span><code>{effect.executionStatus ?? effect.localItemId ?? "inactive"}</code></div>)}</article>)}</section>;
}
