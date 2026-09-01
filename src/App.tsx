import OBR, { isImage, type GridType, type Item, type Layer, type Player } from "@owlbear-rodeo/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AUTHORITY_CONTROL_CHANNEL, AUTHORITY_STATUS_CHANNEL, DETECTOR_KEY, EFFECT_LIBRARY_STORAGE_KEY, EMANATION_INTEGRATION_KEY, EMITTER_KEY, EXTENSION_NAME, RULE_LIBRARY_STORAGE_KEY, RUMBLE_INTEGRATION_KEY, SETTINGS_KEY } from "./constants";
import { parseDetectionRule, parseDetectorMetadata, parseEmitterMetadata } from "./metadata/parse";
import { DEBUG_STORAGE_KEY } from "./runtime/engine";
import { DEFAULT_GEOMETRY, resolveShaderGeometry } from "./effects/shader/geometry";
import { createIntegrationEffect, INTEGRATION_CATALOG } from "./effects/integrations/catalog";
import { IntegrationEffectEditor } from "./effects/integrations/ui/IntegrationEffectEditor";
import { instantiateLibraryEffect, loadEffectLibrary, type EffectLibraryEntryV1, type EffectLibraryV1 } from "./effects/library";
import { instantiateLibraryRule, loadRuleLibrary, type RuleLibraryEntryV1, type RuleLibraryV1 } from "./rules/library";
import { normalizeSignal, parseEmitterSignal } from "./signals/normalize";
import type { DebugRuleState, DetectionRuleV1, DetectorMetadataV1, DynamicValueRange, EffectAudienceV1, EffectDefinitionV1, EffectTargetV1, EmitterMetadataV1, LightEffectDefinitionV1, MechanicalEffectDefinitionV1, ShaderDynamicField, ShaderEffectDefinitionV1, StrengthLinkDirection } from "./types";
import { StatusPanel } from "./components/StatusPanel";
import { useOwlbear } from "./hooks/useOwlbear";
import { DEFAULT_SCENE_SETTINGS, isDistanceMethodValidForGrid, isHexGrid, parseSceneSettings, type SceneSettingsV1 } from "./settings";
import { SliderNumber } from "./components/SliderNumber";
import { DynamicSliderNumber } from "./components/DynamicSliderNumber";
import { DualSliderNumber } from "./components/DualSliderNumber";
import { ToggleOptionLabel } from "./components/ToggleOptionLabel";
import { CaretIcon, GearsIcon, SaveToBookIcon, TrashIcon } from "./components/EditorIcons";
import { SignalCombobox } from "./components/SignalCombobox";
import { EditableTitle } from "./components/EditableTitle";
import { clearEmitterLabels, labelAllEmitters } from "./runtime/emitterLabels";
import type { SharedAuthoritySnapshot } from "./effects/mechanical/authority";
import { parseAuthorityStatus, type AuthorityControlMessage } from "./runtime/authority";
import { resolveEditorSelection } from "./scene/editorSelection";

const newEffect = (): ShaderEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" }, preset: "glow", shape: "circle", placement: "above", color: "#55aaff", maxIntensity: 1, spread: 1.25, animation: { mode: "none", rate: 1, depth: 0.35 } });
const newFaceEffect = (): MechanicalEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "mechanical", enabled: true, action: "face", target: { type: "detector" }, faceAngle: 0, pivotX: 0, pivotY: 0, speed: 180, reverseOnExit: true });
const newVisibilityEffect = (): MechanicalEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "mechanical", enabled: true, action: "visibility", target: { type: "detector" }, visibility: "hidden", reverseOnExit: true });
const newLockEffect = (): MechanicalEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "mechanical", enabled: true, action: "lock", target: { type: "detector" }, locked: true, reverseOnExit: true });
const newSetImageEffect = (): MechanicalEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "mechanical", enabled: true, action: "set-image", target: { type: "detector" }, constrainToOriginalSize: true, reverseOnExit: true });
const newEmitterEffect = (): MechanicalEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "mechanical", enabled: true, action: "emitter", target: { type: "detector" }, operation: "add", signal: "", reverseOnExit: true });
const newLightEffect = (): LightEffectDefinitionV1 => ({ id: crypto.randomUUID(), type: "light", enabled: true, action: "add", duration: "temporary", target: { type: "detector" }, audience: { type: "everyone" }, attenuationRadius: { value: 4 }, sourceRadius: { value: 0 }, falloff: { value: 0.5 }, innerAngle: { value: 360 }, outerAngle: { value: 360 }, lightType: "PRIMARY", radiusOperation: "set", rotationBehavior: "target" });
const aurasEmanationsIcon = INTEGRATION_CATALOG.find((provider) => provider.id === "auras-emanations")?.iconUrl ?? "";
const rumbleIcon = INTEGRATION_CATALOG.find((provider) => provider.id === "rumble")?.iconUrl ?? "";
const newRule = (): DetectionRuleV1 => ({ id: crypto.randomUUID(), enabled: true, signal: "", aggregation: "nearest", ignoreHidden: false, matchType: "exact", excludeLayers: [], range: { outer: 60, inner: 5 }, falloff: "smoothstep", effects: [newEffect()] });
const OBR_LAYERS: Layer[] = ["MAP", "GRID", "DRAWING", "PROP", "MOUNT", "CHARACTER", "ATTACHMENT", "NOTE", "TEXT", "RULER", "FOG", "POINTER", "POST_PROCESS", "CONTROL", "POPOVER"];
const Label = ({ children, tooltip }: { children: React.ReactNode; tooltip?: string }) => <span className="field-label" title={tooltip}>{children}</span>;
const Icon = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
const BugIcon = () => <Icon><path d="M8 8h8v9a4 4 0 0 1-8 0V8Zm2-3h4l1 3H9l1-3ZM5 11h3m8 0h3M5 16h3m8 0h3M7 7 5 5m12 2 2-2" /></Icon>;
const BookIcon = () => <Icon><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z" /></Icon>;
const stateEffectName = (effect: MechanicalEffectDefinitionV1) => effect.action === "face" ? "Face" : effect.action === "visibility" ? "Hide/Show" : effect.action === "lock" ? "Lock/Unlock" : effect.action === "set-image" ? "Set Image" : "Add/Remove Emitter";
const effectDefaultName = (effect: EffectDefinitionV1) => effect.type === "shader" ? effect.preset === "beam" ? "Directional beam" : "Glow/Shadow" : effect.type === "mechanical" ? stateEffectName(effect) : effect.type === "light" ? effect.action === "add" ? "Add Light" : effect.action === "modify" ? "Modify Light" : "Spotlight" : INTEGRATION_CATALOG.find((provider) => provider.id === effect.providerId)?.displayName ?? "Integration effect";
const effectTypeLabel = (effect: EffectDefinitionV1) => effect.type === "shader" ? effect.preset === "glow" ? "Glow/Shadow" : "Directional Beam" : effect.type === "mechanical" ? stateEffectName(effect) : effect.type === "light" ? effect.action === "add" ? "Add Light" : effect.action === "modify" ? "Modify Light" : "Spotlight" : INTEGRATION_CATALOG.find((provider) => provider.id === effect.providerId)?.displayName ?? effect.providerId;
const configurationSignature = (emitter: EmitterMetadataV1, detector: DetectorMetadataV1) => JSON.stringify({
  emitter: emitter.signals.length ? emitter : null,
  detector: detector.rules.length ? detector : null,
});
const confirmDelete = (description: string, action: () => void) => {
  if (window.confirm(`${description}\n\nThis cannot be undone.`)) action();
};

export default function App() {
  const connection = useOwlbear();
  const [items, setItems] = useState<Item[]>([]);
  const [party, setParty] = useState<Player[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [emitter, setEmitter] = useState<EmitterMetadataV1>({ version: 1, enabled: true, signals: [] });
  const [detector, setDetector] = useState<DetectorMetadataV1>({ version: 1, enabled: true, rules: [] });
  const [signalDraft, setSignalDraft] = useState("");
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [debug, setDebug] = useState<DebugRuleState[]>([]);
  const [emitterLabelsVisible, setEmitterLabelsVisible] = useState(false);
  const [emitterLabelCount, setEmitterLabelCount] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [gridUnit, setGridUnit] = useState("");
  const [emanationEnabled, setEmanationEnabled] = useState(() => localStorage.getItem(EMANATION_INTEGRATION_KEY) === "true");
  const [rumbleEnabled, setRumbleEnabled] = useState(false);
  const [sceneSettings, setSceneSettings] = useState<SceneSettingsV1>(DEFAULT_SCENE_SETTINGS);
  const [gridType, setGridType] = useState<GridType>("SQUARE");
  const [effectLibrary, setEffectLibrary] = useState<EffectLibraryV1>(() => loadEffectLibrary(localStorage, EFFECT_LIBRARY_STORAGE_KEY));
  const [ruleLibrary, setRuleLibrary] = useState<RuleLibraryV1>(() => loadRuleLibrary(localStorage, RULE_LIBRARY_STORAGE_KEY));
  const [ruleLibraryOpen, setRuleLibraryOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [authority, setAuthority] = useState<SharedAuthoritySnapshot | null>(null);
  const [authorityPending, setAuthorityPending] = useState(false);
  const [authorityError, setAuthorityError] = useState<string | null>(null);
  const authorityRequest = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
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
    const nextSelectedId = resolveEditorSelection(selectedIdRef.current, selection, allItems.map((item) => item.id));
    const nextSignature = nextSelectedId === null ? "none" : `item:${nextSelectedId}`;
    if (selectionSignature.current !== nextSignature) {
      selectionSignature.current = nextSignature;
      setShowSettings(nextSelectedId === null);
      setShowDebug(false);
    }
    selectedIdRef.current = nextSelectedId;
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
    const applySettings = (metadata: Awaited<ReturnType<typeof OBR.scene.getMetadata>>) => {
      setSceneSettings(parseSceneSettings(metadata[SETTINGS_KEY]));
      setRumbleEnabled(metadata[RUMBLE_INTEGRATION_KEY] === true);
    };
    void OBR.scene.getMetadata().then(applySettings);
    const stopSettings = OBR.scene.onMetadataChange(applySettings);
    return stopSettings;
  }, [connection.sceneReady, connection.status]);

  useEffect(() => {
    if (!selected) return;
    const nextEmitter = parseEmitterMetadata(selected.metadata[EMITTER_KEY]) ?? { version: 1 as const, enabled: true, signals: [] };
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

  useEffect(() => {
    if (connection.status !== "ready") return;
    const stop = OBR.broadcast.onMessage(AUTHORITY_STATUS_CHANNEL, (event) => {
      const message = parseAuthorityStatus(event.data);
      if (!message) return;
      setAuthority(message.snapshot);
      if (message.requestId && message.requestId === authorityRequest.current) {
        authorityRequest.current = null;
        setAuthorityPending(false);
        setAuthorityError(message.error ?? null);
      }
    });
    const requestId = crypto.randomUUID();
    void OBR.broadcast.sendMessage(AUTHORITY_CONTROL_CHANNEL, { version: 1, type: "request-status", requestId } satisfies AuthorityControlMessage, { destination: "LOCAL" });
    return stop;
  }, [connection.status]);

  const sendAuthorityCommand = useCallback((type: "take-control" | "release-control") => {
    const requestId = crypto.randomUUID();
    authorityRequest.current = requestId;
    setAuthorityPending(true);
    setAuthorityError(null);
    void OBR.broadcast.sendMessage(AUTHORITY_CONTROL_CHANNEL, { version: 1, type, requestId } satisfies AuthorityControlMessage, { destination: "LOCAL" }).catch(() => {
      if (authorityRequest.current !== requestId) return;
      authorityRequest.current = null;
      setAuthorityPending(false);
      setAuthorityError("Unable to contact the Sting background runtime. Reload the room and try again.");
    });
  }, []);

  useEffect(() => {
    if (connection.sceneReady) return;
    setEmitterLabelsVisible(false);
    setEmitterLabelCount(0);
    void clearEmitterLabels();
  }, [connection.sceneReady]);

  useEffect(() => () => { void clearEmitterLabels(); }, []);

  const updateRule = (index: number, update: (rule: DetectionRuleV1) => DetectionRuleV1) => setDetector((current) => ({ ...current, rules: current.rules.map((rule, i) => i === index ? update(rule) : rule) }));
  const updateEffect = (ruleIndex: number, effectIndex: number, update: (effect: EffectDefinitionV1) => EffectDefinitionV1) => updateRule(ruleIndex, (rule) => ({ ...rule, effects: rule.effects.map((effect, i) => i === effectIndex ? update(effect) : effect) }));
  const toggleEmanation = (enabled: boolean) => { localStorage.setItem(EMANATION_INTEGRATION_KEY, String(enabled)); setEmanationEnabled(enabled); };
  const toggleRumble = (enabled: boolean) => {
    setRumbleEnabled(enabled);
    setSettingsError(null);
    void OBR.scene.setMetadata({ [RUMBLE_INTEGRATION_KEY]: enabled }).catch(() => {
      setSettingsError("Unable to save the Rumble! integration setting.");
      void OBR.scene.getMetadata().then((metadata) => setRumbleEnabled(metadata[RUMBLE_INTEGRATION_KEY] === true));
    });
  };
  const toggleEmitterLabels = () => {
    if (emitterLabelsVisible) {
      void clearEmitterLabels().then(() => { setEmitterLabelsVisible(false); setEmitterLabelCount(0); });
      return;
    }
    void labelAllEmitters(items).then((count) => { setEmitterLabelsVisible(count > 0); setEmitterLabelCount(count); });
  };
  const updateDistanceMethod = (distanceMethod: SceneSettingsV1["distanceMethod"]) => {
    const next: SceneSettingsV1 = { version: 1, distanceMethod };
    setSceneSettings(next);
    setSettingsError(null);
    void OBR.scene.setMetadata({ [SETTINGS_KEY]: next }).catch(() => {
      setSettingsError("Unable to save scene settings.");
      void OBR.scene.getMetadata().then((metadata) => setSceneSettings(parseSceneSettings(metadata[SETTINGS_KEY])));
    });
  };
  const saveEffectLibrary = (next: EffectLibraryV1) => {
    try {
      localStorage.setItem(EFFECT_LIBRARY_STORAGE_KEY, JSON.stringify(next));
      setEffectLibrary(next);
      setSettingsError(null);
    } catch {
      setSettingsError("Unable to save the effects library in this browser.");
    }
  };
  const saveEffectToLibrary = (effect: EffectDefinitionV1) => {
    const suggested = effect.name ?? effectDefaultName(effect);
    const name = window.prompt("Name this library effect", suggested)?.trim();
    if (!name) return;
    const entry: EffectLibraryEntryV1 = { id: crypto.randomUUID(), name: name.slice(0, 80), effect: structuredClone(effect) };
    saveEffectLibrary({ version: 1, entries: [...effectLibrary.entries, entry] });
  };
  const saveRuleLibrary = (next: RuleLibraryV1) => {
    try {
      localStorage.setItem(RULE_LIBRARY_STORAGE_KEY, JSON.stringify(next));
      setRuleLibrary(next);
      setSettingsError(null);
    } catch {
      setSettingsError("Unable to save the rules library in this browser.");
    }
  };
  const saveRuleToLibrary = (rule: DetectionRuleV1) => {
    const normalized = parseDetectionRule(rule);
    if (!normalized) { setSaveError("Finish configuring this rule before saving it to the library."); return; }
    const suggested = rule.name ?? `Rule: ${rule.signal || "signal"}`;
    const name = window.prompt("Name this library rule", suggested)?.trim();
    if (!name) return;
    const entry: RuleLibraryEntryV1 = { id: crypto.randomUUID(), name: name.slice(0, 80), rule: structuredClone(normalized) };
    saveRuleLibrary({ version: 1, entries: [...ruleLibrary.entries, entry] });
  };
  const addSignal = () => {
    const parsed = parseEmitterSignal(signalDraft);
    if (!parsed) {
      setSaveError("Use a signal name optionally followed by a positive range, such as light[20].");
      return;
    }
    if (!emitter.signals.includes(parsed.tag)) setEmitter({ ...emitter, signals: [...emitter.signals, parsed.tag] });
    setSignalDraft("");
    setSaveError(null);
  };

  useEffect(() => {
    if (!selected || connection.role !== "GM" || hydratedItemId.current !== selected.id) return;
    const normalizedDetector = parseDetectorMetadata(detector);
    if (detector.rules.length && !normalizedDetector) {
      setSaveError("Fix invalid settings: signals are required, range and radius inner values must be below their outer values, and offsets must stay between -100% and 100%.");
      setAutosaveStatus("error");
      return;
    }
    const normalizedEmitter = parseEmitterMetadata(emitter) ?? { version: 1 as const, enabled: true, signals: [] };
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
    <header className="app-header"><div className="brand"><img src="./icon.svg" alt="" /><h1>{EXTENSION_NAME}</h1></div><nav className="header-actions" aria-label="Extension views"><button className={`icon-button${showDebug ? " active" : ""}`} title="Debug runtime" aria-label="Debug runtime" onClick={() => { setShowDebug((value) => !value); setShowSettings(false); }}><BugIcon /></button><button className={`icon-button${showSettings ? " active" : ""}`} title="Settings" aria-label="Settings" onClick={() => { setShowSettings((value) => !value); setShowDebug(false); }}><GearsIcon /></button><a className="icon-button" href={extensionRoot} target="_blank" rel="noreferrer" title="Open Sting help" aria-label="Open Sting help">?</a></nav></header>
    {!connection.sceneReady && <div className="notice">Open a scene to configure proximity signals.</div>}
    {connection.sceneReady && connection.role !== "GM" && <div className="notice">The runtime is active. Only the GM can configure scene items.</div>}
    {connection.sceneReady && connection.role === "GM" && !selected && <div className="notice">Select exactly one scene item to configure it.</div>}
    {connection.status === "ready" && showSettings && <section className="content-card settings-section"><div className="section-title"><div><h2>Settings</h2><p className="muted">Distance settings for this scene</p></div></div>
      <div className="settings-content">
        <label title="Choose how Sting measures ranges and determines which signal is closest."><Label tooltip="Choose how Sting measures ranges and determines which signal is closest.">Distance calculation</Label><select title="Choose the distance calculation method for this scene." value={displayedDistanceMethod} disabled={connection.role !== "GM" || !connection.sceneReady} onChange={(event) => updateDistanceMethod(event.target.value as SceneSettingsV1["distanceMethod"])}><option value="scene">Use scene measurement type</option>{isHexGrid(gridType) ? <><option value="hexagon">Hexagon</option><option value="euclidean">Euclidean</option></> : <><option value="chessboard">Chessboard (D&amp;D 5e)</option><option value="alternating">Alternating Diagonal (D&amp;D 3.5e)</option><option value="euclidean">Euclidean</option><option value="manhattan">Manhattan</option></>}</select></label>
        <p className="muted">Controls signal range, falloff, and which signal is considered closest.</p>
        <div className="settings-subsection"><div className="section-title"><strong>Rules Library</strong><span className="library-count">{ruleLibrary.entries.length}</span></div>{ruleLibrary.entries.length ? <div className="library-list">{ruleLibrary.entries.map((entry) => <div className="library-row" key={entry.id}><span><strong>{entry.name}</strong><small>{entry.rule.signal} · {entry.rule.effects.length} effect{entry.rule.effects.length === 1 ? "" : "s"}</small></span><button className="mini-icon danger" title={`Delete ${entry.name} from the rules library.`} aria-label={`Delete ${entry.name} from the rules library`} onClick={() => confirmDelete(`Delete “${entry.name}” from the rules library?`, () => saveRuleLibrary({ version: 1, entries: ruleLibrary.entries.filter((candidate) => candidate.id !== entry.id) }))}><TrashIcon /></button></div>)}</div> : <p className="muted library-empty">Save a rule with all of its effects to reuse it later in this browser.</p>}</div>
        <div className="settings-subsection"><div className="section-title"><strong>Effects Library</strong><span className="library-count">{effectLibrary.entries.length}</span></div>{effectLibrary.entries.length ? <div className="library-list">{effectLibrary.entries.map((entry) => <div className="library-row" key={entry.id}><span><strong>{entry.name}</strong><small>{effectTypeLabel(entry.effect)}</small></span><button className="mini-icon danger" title={`Delete ${entry.name} from the effects library.`} aria-label={`Delete ${entry.name} from the effects library`} onClick={() => confirmDelete(`Delete “${entry.name}” from the effects library?`, () => saveEffectLibrary({ version: 1, entries: effectLibrary.entries.filter((candidate) => candidate.id !== entry.id) }))}><TrashIcon /></button></div>)}</div> : <p className="muted library-empty">Save an effect to reuse it later in this browser.</p>}</div>
        <div className="settings-subsection"><strong>Integrations</strong><div className="extension-row"><div className="integration-identity"><img src={aurasEmanationsIcon} alt="" /><div><strong>Auras &amp; Emanations</strong><p className="muted">Trigger named presets through the installed extension.</p></div></div><label className="toggle" title="Allow Sting rules to execute Auras &amp; Emanations actions."><input type="checkbox" aria-label="Allow Auras & Emanations integration" checked={emanationEnabled} disabled={connection.role !== "GM"} onChange={(event) => toggleEmanation(event.target.checked)} /></label></div><div className="extension-row"><div className="integration-identity"><img src={rumbleIcon} alt="" /><div><strong>Rumble!</strong><p className="muted">Send chat messages and party-visible dice rolls through Rumble!.</p></div></div><label className="toggle" title="Allow Sting rules to execute Rumble! actions for this scene."><input type="checkbox" aria-label="Allow Rumble integration" checked={rumbleEnabled} disabled={connection.role !== "GM" || !connection.sceneReady} onChange={(event) => toggleRumble(event.target.checked)} /></label></div><p className="integration-disclaimer">Sting communicates with third-party extensions only through their published, public interfaces. Listing an integration does not imply affiliation, partnership, sponsorship, or endorsement by either party.</p></div>
        {settingsError && <div className="validation-error" role="alert">{settingsError}</div>}
      </div>
    </section>}
    {showDebug ? <><div className="debug-emitter-labels"><button className="wide-button" disabled={!connection.sceneReady} onClick={toggleEmitterLabels}>{emitterLabelsVisible ? "Clear emitter labels" : "Label all emitters"}</button>{emitterLabelsVisible && <p className="muted" role="status">Showing {emitterLabelCount} local emitter label{emitterLabelCount === 1 ? "" : "s"}.</p>}</div><DebugView rules={debug} authority={authority} pending={authorityPending} error={authorityError} onTakeControl={() => sendAuthorityCommand("take-control")} onReleaseControl={() => sendAuthorityCommand("release-control")} /></> : selected && !showSettings && connection.role === "GM" ? <>
      <section className="item-heading"><div className="selected-thumbnail">{isImage(selected) && selected.image.mime.startsWith("image/") ? <img src={selected.image.url} alt="" /> : <span aria-hidden="true">◇</span>}</div><div><span className="eyebrow">Selected item</span><h2>{selected.name || "Unnamed item"}</h2><code>{selected.id}</code></div></section>
      <section className="content-card"><div className="section-title"><h2 title="Add detectable signal tags. End a tag with a range such as [20] to cap it in scene units.">Emitter</h2><label className="toggle" title="Enable or disable every signal emitted by this item."><input type="checkbox" aria-label="Enable emitter" checked={emitter.enabled} onChange={(event) => setEmitter({ ...emitter, enabled: event.target.checked })} /></label></div><div className="chips">{emitter.signals.map((signal) => <button title={`Remove the ${signal} signal from this item.`} key={signal} className="chip" onClick={() => setEmitter({ ...emitter, signals: emitter.signals.filter((value) => value !== signal) })}>{signal}<span>×</span></button>)}</div><div className="input-row"><SignalCombobox value={signalDraft} options={sceneSignals} onChange={setSignalDraft} onEnter={addSignal} /><button title="Add this signal to the selected item." onClick={addSignal}>Add</button></div></section>
      <section className="content-card"><div className="section-title"><h2 title="Add detection rules that respond when matching emitter tags are within range.">Detector</h2><label className="toggle" title="Enable or disable every detection rule on this item."><input type="checkbox" aria-label="Enable detector" checked={detector.enabled} onChange={(event) => setDetector({ ...detector, enabled: event.target.checked })} /></label></div>{detector.rules.map((rule, ruleIndex) => <RuleEditor key={rule.id} rule={rule} index={ruleIndex} unit={gridUnit} items={items} party={party} emanationEnabled={emanationEnabled} library={effectLibrary.entries} onSaveRule={() => saveRuleToLibrary(rule)} onSaveEffect={saveEffectToLibrary} onChange={(update) => updateRule(ruleIndex, update)} onEffect={(effectIndex, update) => updateEffect(ruleIndex, effectIndex, update)} onDelete={() => confirmDelete(`Delete Rule ${ruleIndex + 1} and all of its effects?`, () => setDetector({ ...detector, rules: detector.rules.filter((_, i) => i !== ruleIndex) }))} />)}<div className="rule-add-actions"><button className="wide-button" title="Add another detection rule to this item." onClick={() => setDetector({ ...detector, rules: [...detector.rules, newRule()] })}>+ Add detection rule</button><button className={`mini-icon${ruleLibraryOpen ? " active" : ""}`} title={ruleLibrary.entries.length ? "Add a saved rule from your browser-local library." : "Your browser-local rules library is empty."} aria-label="Add rule from the rules library" disabled={!ruleLibrary.entries.length} onClick={() => setRuleLibraryOpen((value) => !value)}><BookIcon /></button></div>{ruleLibraryOpen && <div className="library-picker">{ruleLibrary.entries.map((entry) => <button key={entry.id} title={`Add ${entry.name} and all of its effects.`} onClick={() => { setDetector((current) => ({ ...current, rules: [...current.rules, instantiateLibraryRule(entry)] })); setRuleLibraryOpen(false); }}><span>{entry.name}</span><small>{entry.rule.signal} · {entry.rule.effects.length} effect{entry.rule.effects.length === 1 ? "" : "s"}</small></button>)}</div>}</section>
      {saveError && <div className="validation-error" role="alert">{saveError}</div>}<div className="autosave-status" role="status">{autosaveStatus === "saving" ? "Saving…" : autosaveStatus === "error" ? "Not saved" : "Saved automatically"}</div>
    </> : null}
  </main>;
}

interface RuleEditorProps { rule: DetectionRuleV1; index: number; unit: string; items: Item[]; party: Player[]; emanationEnabled: boolean; library: EffectLibraryEntryV1[]; onSaveRule: () => void; onSaveEffect: (effect: EffectDefinitionV1) => void; onChange: (update: (rule: DetectionRuleV1) => DetectionRuleV1) => void; onEffect: (index: number, update: (effect: EffectDefinitionV1) => EffectDefinitionV1) => void; onDelete: () => void; }
function RuleEditor({ rule, index, unit, items, party, emanationEnabled, library, onSaveRule, onSaveEffect, onChange, onEffect, onDelete }: RuleEditorProps) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const enabledProviders = INTEGRATION_CATALOG.filter((provider) => provider.id !== "auras-emanations" || emanationEnabled);
  return <article className="rule-card"><div className="section-title"><div className="card-heading-main"><button className="collapse-button" title={collapsed ? "Expand rule" : "Collapse rule"} aria-label={collapsed ? `Expand rule ${index + 1}` : `Collapse rule ${index + 1}`} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}><CaretIcon collapsed={collapsed} /></button><EditableTitle as="h3" value={rule.name} fallback={`Rule ${index + 1}`} ariaLabel={`Rename rule ${index + 1}`} onChange={(name) => onChange((value) => ({ ...value, name }))} /></div><div className="rule-header-actions"><button className="mini-icon" title="Save this rule and all of its effects to your browser-local library." aria-label={`Save rule ${index + 1} to library`} onClick={onSaveRule}><SaveToBookIcon /></button><label className="toggle" title="Enable or disable this detection rule."><input type="checkbox" aria-label={`Enable rule ${index + 1}`} checked={rule.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /></label><button className="mini-icon danger delete-icon" title="Delete this detection rule." aria-label={`Delete rule ${index + 1}`} onClick={onDelete}><TrashIcon /></button></div></div>{!collapsed && <><div className="form-grid">
    <label title="Choose the kind of source this detector observes."><Label>Source Type</Label><select value={rule.source?.type ?? "sting-emitter"} onChange={(event) => onChange((value) => ({ ...value, source: event.target.value === "obr-light" ? { type: "obr-light", detection: "distance", ownership: "any", attachment: "any" } : { type: event.target.value as "sting-emitter" | "item-name" | "item-label" } }))}><option value="sting-emitter">Sting Emitter</option><option value="item-name">Item Name</option><option value="item-label">Item Label</option><option value="obr-light">OBR Light</option></select></label>
    {rule.source?.type === "obr-light" ? <label title="Geometric light-area detection does not account for walls or shadows."><Label>Light Detection</Label><select value={rule.source.detection} onChange={(event) => onChange((value) => ({ ...value, source: value.source?.type === "obr-light" ? { ...value.source, detection: event.target.value as "distance" | "within-radius" } : value.source }))}><option value="distance">Distance from Source</option><option value="within-radius">Within Light Radius</option></select></label> : <label title="Value this rule matches after case and spacing normalization."><Label>{rule.source?.type === "item-name" ? "Item Name" : rule.source?.type === "item-label" ? "Item Label" : "Signal"}</Label><input value={rule.signal} placeholder={rule.source?.type === "item-name" ? "Add item name…" : rule.source?.type === "item-label" ? "Add item label…" : "Add signal…"} onChange={(event) => onChange((value) => ({ ...value, signal: event.target.value }))} /></label>}
    <label title="How effect strength changes between the full-strength and outer ranges."><Label tooltip="How effect strength changes between the full-strength and outer ranges.">Falloff</Label><select value={rule.falloff} onChange={(event) => onChange((value) => ({ ...value, falloff: event.target.value as DetectionRuleV1["falloff"] }))}><option value="smoothstep">Smooth</option><option value="linear">Linear</option><option value="logarithmic">Logarithmic</option><option value="binary">Binary</option></select></label>
    <label title="Choose the closest matching emitter or every matching emitter in range."><Label tooltip="Choose the closest matching emitter or every matching emitter in range.">Detection mode</Label><select value={rule.aggregation} onChange={(event) => onChange((value) => ({ ...value, aggregation: event.target.value as DetectionRuleV1["aggregation"] }))}><option value="nearest">Closest signal</option><option value="all">All signals in range</option></select></label>
    <label className="checkbox-field" title="Exclude hidden emitters from this rule's detection results."><Label tooltip="Exclude hidden emitters from this rule's detection results.">Ignore hidden items</Label><span className="toggle"><input type="checkbox" aria-label="Ignore hidden items" checked={rule.ignoreHidden} onChange={(event) => onChange((value) => ({ ...value, ignoreHidden: event.target.checked }))} /></span></label>
    {!(rule.source?.type === "obr-light" && rule.source.detection === "within-radius") && <DualSliderNumber className="wide" tooltip="Black sets the outer edge where detection reaches zero; blue sets the distance at or below which detection has full strength." label="Detection range" labelContent={<span className="field-label">Detection range{unit ? ` (${unit})` : ""}</span>} minimumValue={rule.range.outer} maximumValue={rule.range.inner} min={0} minimumMin={0.5} maximumMin={0} step={0.5} suffix={unit ? ` ${unit}` : ""} order="descending" minimumEndpointLabel="Outer range" maximumEndpointLabel="Full strength at" onChange={(outer, inner) => onChange((value) => ({ ...value, range: { outer, inner } }))} />}
    <details className="advanced-section rule-advanced wide"><summary>Advanced rule settings</summary><div className="advanced-grid">
      {rule.source?.type !== "obr-light" && <label title="Choose how the configured text is compared with source text."><Label>Match Type</Label><select value={rule.matchType} onChange={(event) => onChange((value) => ({ ...value, matchType: event.target.value as DetectionRuleV1["matchType"] }))}><option value="exact">Exact</option><option value="wildcard">Wildcard (*?)</option><option value="regex">Regex</option></select></label>}
      <label className={rule.source?.type === "obr-light" ? "wide" : undefined} title="Items on selected Owlbear Rodeo layers are excluded from this rule."><Label>Exclude Layers</Label><select className="layer-multiselect" multiple value={rule.excludeLayers} onChange={(event) => onChange((value) => ({ ...value, excludeLayers: [...event.target.selectedOptions].map((option) => option.value as Layer) }))}>{OBR_LAYERS.map((layer) => <option key={layer} value={layer}>{layer.replaceAll("_", " ")}</option>)}</select></label>
    </div></details>
  </div><div className="effects-heading"><h4>Effects <span className="effect-count">{rule.effects.length}</span></h4><div className="effect-add-actions" aria-label="Add effect"><button className="effect-glyph" title="New shader effect" aria-label="New shader effect" onClick={() => onChange((value) => ({ ...value, effects: [...value.effects, newEffect()] }))}><span className="glow-glyph" /></button><button className="effect-glyph" title="New state effect" aria-label="New state effect" onClick={() => onChange((value) => ({ ...value, effects: [...value.effects, newFaceEffect()] }))}><GearsIcon /></button><button className="effect-glyph" title="New light effect" aria-label="New light effect" onClick={() => onChange((value) => ({ ...value, effects: [...value.effects, newLightEffect()] }))}>☀</button><button className={`effect-glyph${libraryOpen ? " active" : ""}`} title={library.length ? "Add an effect from your browser-local library." : "Your browser-local effects library is empty."} aria-label="Add an effect from the effects library" disabled={!library.length} onClick={() => setLibraryOpen((value) => !value)}><BookIcon /></button>{enabledProviders.map((provider) => <button className="effect-glyph" key={provider.id} title={`Add ${provider.displayName} effect.`} aria-label={`Add ${provider.displayName} effect`} onClick={() => onChange((value) => ({ ...value, effects: [...value.effects, createIntegrationEffect(provider.id, provider.actions[0].id)] }))}><img src={provider.iconUrl} alt="" /></button>)}</div></div>{libraryOpen && <div className="library-picker">{library.map((entry) => <button key={entry.id} title={`Add ${entry.name} to this rule.`} onClick={() => { onChange((value) => ({ ...value, effects: [...value.effects, instantiateLibraryEffect(entry)] })); setLibraryOpen(false); }}><span>{entry.name}</span><small>{effectTypeLabel(entry.effect)}</small></button>)}</div>}{rule.effects.map((effect, effectIndex) => { const deleteEffect = () => confirmDelete(`Delete effect ${effectIndex + 1} from Rule ${index + 1}?`, () => onChange((value) => ({ ...value, effects: value.effects.filter((_, i) => i !== effectIndex) }))); return effect.type === "shader" ? <EffectEditor key={effect.id} effect={effect} items={items} party={party} onSave={() => onSaveEffect(effect)} onChange={(update) => onEffect(effectIndex, (current) => current.type === "shader" ? update(current) : current)} onDelete={deleteEffect} /> : effect.type === "mechanical" ? <MechanicalEffectEditor key={effect.id} effect={effect} items={items} onSave={() => onSaveEffect(effect)} onChange={(update) => onEffect(effectIndex, (current) => current.type === "mechanical" ? update(current) : current)} onDelete={deleteEffect} /> : <IntegrationEffectEditor key={effect.id} effect={effect} items={items} providerEnabled={emanationEnabled} onSave={() => onSaveEffect(effect)} onChange={(update) => onEffect(effectIndex, (current) => (current.type === "integration" || current.type === "light") ? update(current) : current)} onDelete={deleteEffect} />; })}</>}</article>;
}

function MechanicalEffectEditor({ effect, items, onSave, onChange, onDelete }: { effect: MechanicalEffectDefinitionV1; items: Item[]; onSave: () => void; onChange: (update: (effect: MechanicalEffectDefinitionV1) => MechanicalEffectDefinitionV1) => void; onDelete: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const switchAction = (action: MechanicalEffectDefinitionV1["action"]) => onChange((current) => {
    const next = action === "face" ? newFaceEffect() : action === "visibility" ? newVisibilityEffect() : action === "lock" ? newLockEffect() : action === "set-image" ? newSetImageEffect() : newEmitterEffect();
    return { ...next, id: current.id, name: current.name, enabled: current.enabled, target: current.target } as MechanicalEffectDefinitionV1;
  });
  if (effect.action === "visibility") return <VisibilityEffectEditor effect={effect} items={items} onSave={onSave} onActionChange={switchAction} onChange={(update) => onChange((current) => current.action === "visibility" ? update(current) : current)} onDelete={onDelete} />;
  if (effect.action === "lock") return <LockEffectEditor effect={effect} items={items} onSave={onSave} onActionChange={switchAction} onChange={(update) => onChange((current) => current.action === "lock" ? update(current) : current)} onDelete={onDelete} />;
  if (effect.action === "set-image") return <SetImageEffectEditor effect={effect} items={items} onSave={onSave} onActionChange={switchAction} onChange={(update) => onChange((current) => current.action === "set-image" ? update(current) : current)} onDelete={onDelete} />;
  if (effect.action === "emitter") return <EmitterEffectEditor effect={effect} items={items} onSave={onSave} onActionChange={switchAction} onChange={(update) => onChange((current) => current.action === "emitter" ? update(current) : current)} onDelete={onDelete} />;
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  return <div className="effect-card"><div className="section-title"><div className="card-heading-main"><button className="collapse-button" title={collapsed ? "Expand effect" : "Collapse effect"} aria-label={collapsed ? "Expand Face effect" : "Collapse Face effect"} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}><CaretIcon collapsed={collapsed} /></button><EditableTitle value={effect.name} fallback="Face" ariaLabel="Rename Face effect" onChange={(name) => onChange((value) => ({ ...value, name }))} /></div><div className="effect-header-actions"><button className="mini-icon" title="Save this effect to your browser-local library." aria-label="Save effect to library" onClick={onSave}><SaveToBookIcon /></button><label className="toggle" title="Enable or disable this effect."><input type="checkbox" aria-label="Enable Face effect" checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /></label><button className="mini-icon danger delete-icon" title="Delete effect" aria-label="Delete Face effect" onClick={onDelete}><TrashIcon /></button></div></div>{!collapsed && <div className="form-grid">
    <StateActionSelect value={effect.action} onChange={switchAction} />
    <label className="wide" title="Scene item that rotates to face the closest emitter."><Label tooltip="Scene item that rotates to face the closest emitter.">Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Self</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter(s)</option><option value="specific-item">Specific item</option></select></label>
    {effect.target.type === "specific-item" && <label className="wide" title="Exact scene item to rotate."><Label tooltip="Exact scene item to rotate.">Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
    <SliderNumber className="wide" tooltip="Direction the artwork faces at zero token rotation; 0° is north/up." label="Face" min={0} max={359} step={1} value={effect.faceAngle} suffix="°" onChange={(faceAngle) => onChange((value) => ({ ...value, faceAngle }))} />
    <div className="paired-controls wide"><SliderNumber tooltip="Horizontal pivot offset from the item center; ±100% reaches the current bounds edge." label="Pivot X" min={-500} max={500} step={5} inputStep={1} value={effect.pivotX} suffix="%" onChange={(pivotX) => onChange((value) => ({ ...value, pivotX }))} /><SliderNumber tooltip="Vertical pivot offset from the item center; ±100% reaches the current bounds edge." label="Pivot Y" min={-500} max={500} step={5} inputStep={1} value={effect.pivotY} suffix="%" onChange={(pivotY) => onChange((value) => ({ ...value, pivotY }))} /></div>
    <SliderNumber className="wide" tooltip="Constant angular turning speed." label="Speed" min={15} max={720} step={15} value={effect.speed} suffix="°/s" onChange={(speed) => onChange((value) => ({ ...value, speed }))} />
    <label className="checkbox-field wide"><Label>Reverse on threshold exit</Label><span className="toggle"><input type="checkbox" aria-label="Restore original facing on threshold exit" checked={effect.reverseOnExit} onChange={(event) => onChange((value) => ({ ...value, reverseOnExit: event.target.checked }))} /></span></label>
  </div>}</div>;
}

function VisibilityEffectEditor({ effect, items, onSave, onActionChange, onChange, onDelete }: { effect: Extract<MechanicalEffectDefinitionV1, { action: "visibility" }>; items: Item[]; onSave: () => void; onActionChange: (action: MechanicalEffectDefinitionV1["action"]) => void; onChange: (update: (effect: Extract<MechanicalEffectDefinitionV1, { action: "visibility" }>) => Extract<MechanicalEffectDefinitionV1, { action: "visibility" }>) => void; onDelete: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  return <div className="effect-card"><div className="section-title"><div className="card-heading-main"><button className="collapse-button" title={collapsed ? "Expand effect" : "Collapse effect"} aria-label={collapsed ? "Expand Hide/Show effect" : "Collapse Hide/Show effect"} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}><CaretIcon collapsed={collapsed} /></button><EditableTitle value={effect.name} fallback="Hide/Show" ariaLabel="Rename Hide/Show effect" onChange={(name) => onChange((value) => ({ ...value, name }))} /></div><div className="effect-header-actions"><button className="mini-icon" title="Save this effect to your browser-local library." aria-label="Save effect to library" onClick={onSave}><SaveToBookIcon /></button><label className="toggle" title="Enable or disable this effect."><input type="checkbox" aria-label="Enable Hide/Show effect" checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /></label><button className="mini-icon danger delete-icon" title="Delete effect" aria-label="Delete Hide/Show effect" onClick={onDelete}><TrashIcon /></button></div></div>{!collapsed && <div className="form-grid">
    <StateActionSelect value={effect.action} onChange={onActionChange} />
    <label className="wide" title="Scene item whose visibility changes when the threshold is crossed."><Label tooltip="Scene item whose visibility changes when the threshold is crossed.">Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Self</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter(s)</option><option value="specific-item">Specific item</option></select></label>
    {effect.target.type === "specific-item" && <label className="wide" title="Exact scene item whose visibility changes."><Label tooltip="Exact scene item whose visibility changes.">Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
    <label className="wide" title="Visibility to apply when a matching emitter crosses into range."><Label tooltip="Visibility to apply when a matching emitter crosses into range.">On threshold entry</Label><select value={effect.visibility} onChange={(event) => onChange((value) => ({ ...value, visibility: event.target.value as "hidden" | "shown" | "toggle" }))}><option value="hidden">Become hidden</option><option value="shown">Become shown</option><option value="toggle">Toggle hidden</option></select></label>
    <label className="checkbox-field wide" title="Apply the opposite visibility when the final matching emitter crosses back out of range."><Label tooltip="Apply the opposite visibility when the final matching emitter crosses back out of range.">Reverse on threshold exit</Label><span className="toggle"><input type="checkbox" aria-label="Reverse on threshold exit" checked={effect.reverseOnExit} onChange={(event) => onChange((value) => ({ ...value, reverseOnExit: event.target.checked }))} /></span></label>
  </div>}</div>;
}

function StateActionSelect({ value, onChange }: { value: MechanicalEffectDefinitionV1["action"]; onChange: (action: MechanicalEffectDefinitionV1["action"]) => void }) {
  return <label className="wide" title="Choose the shared scene behavior this state effect applies."><Label tooltip="Choose the shared scene behavior this state effect applies.">Action</Label><select value={value} onChange={(event) => onChange(event.target.value as MechanicalEffectDefinitionV1["action"])}><option value="face">Face</option><option value="visibility">Hide/Show</option><option value="lock">Lock/Unlock</option><option value="set-image">Set Image</option><option value="emitter">Add/Remove Emitter</option></select></label>;
}

type StateEditorProps<T extends MechanicalEffectDefinitionV1> = { effect: T; items: Item[]; onSave: () => void; onActionChange: (action: MechanicalEffectDefinitionV1["action"]) => void; onChange: (update: (effect: T) => T) => void; onDelete: () => void };

function StateEffectHeader<T extends MechanicalEffectDefinitionV1>({ effect, title, collapsed, onCollapsed, onSave, onChange, onDelete }: { effect: T; title: string; collapsed: boolean; onCollapsed: () => void; onSave: () => void; onChange: (update: (effect: T) => T) => void; onDelete: () => void }) {
  return <div className="section-title"><div className="card-heading-main"><button className="collapse-button" title={collapsed ? "Expand effect" : "Collapse effect"} aria-label={collapsed ? `Expand ${title} effect` : `Collapse ${title} effect`} aria-expanded={!collapsed} onClick={onCollapsed}><CaretIcon collapsed={collapsed} /></button><EditableTitle value={effect.name} fallback={title} ariaLabel={`Rename ${title} effect`} onChange={(name) => onChange((value) => ({ ...value, name }))} /></div><div className="effect-header-actions"><button className="mini-icon" title="Save this effect to your browser-local library." aria-label="Save effect to library" onClick={onSave}><SaveToBookIcon /></button><label className="toggle" title="Enable or disable this effect."><input type="checkbox" aria-label={`Enable ${title} effect`} checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /></label><button className="mini-icon danger delete-icon" title="Delete effect" aria-label={`Delete ${title} effect`} onClick={onDelete}><TrashIcon /></button></div></div>;
}

function StateTarget<T extends MechanicalEffectDefinitionV1>({ effect, items, description, onChange }: { effect: T; items: Item[]; description: string; onChange: (update: (effect: T) => T) => void }) {
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  return <><label className="wide" title={description}><Label tooltip={description}>Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Self</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter(s)</option><option value="specific-item">Specific item</option></select></label>{effect.target.type === "specific-item" && <label className="wide" title="Exact scene item to change."><Label tooltip="Exact scene item to change.">Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}</>;
}

function LockEffectEditor({ effect, items, onSave, onActionChange, onChange, onDelete }: StateEditorProps<Extract<MechanicalEffectDefinitionV1, { action: "lock" }>>) {
  const [collapsed, setCollapsed] = useState(false);
  return <div className="effect-card"><StateEffectHeader effect={effect} title="Lock/Unlock" collapsed={collapsed} onCollapsed={() => setCollapsed((value) => !value)} onSave={onSave} onChange={onChange} onDelete={onDelete} />{!collapsed && <div className="form-grid"><StateActionSelect value={effect.action} onChange={onActionChange} /><StateTarget effect={effect} items={items} description="Scene item whose locked state changes when the threshold is crossed." onChange={onChange} /><label className="wide"><Label>On threshold entry</Label><select value={effect.toggle ? "toggle" : effect.locked ? "locked" : "unlocked"} onChange={(event) => onChange((value) => ({ ...value, toggle: event.target.value === "toggle" || undefined, locked: event.target.value === "locked" }))}><option value="locked">Become locked</option><option value="unlocked">Become unlocked</option><option value="toggle">Toggle lock</option></select></label><label className="checkbox-field wide"><Label>Reverse on threshold exit</Label><span className="toggle"><input type="checkbox" aria-label="Reverse locked state on threshold exit" checked={effect.reverseOnExit} onChange={(event) => onChange((value) => ({ ...value, reverseOnExit: event.target.checked }))} /></span></label></div>}</div>;
}

function SetImageEffectEditor({ effect, items, onSave, onActionChange, onChange, onDelete }: StateEditorProps<Extract<MechanicalEffectDefinitionV1, { action: "set-image" }>>) {
  const [collapsed, setCollapsed] = useState(false);
  const chooseImage = async () => {
    try {
      const [asset] = await OBR.assets.downloadImages(false);
      if (asset) onChange((value) => ({ ...value, asset: { name: asset.name, image: asset.image, grid: asset.grid } }));
    } catch { /* closing or denying the picker leaves the current selection unchanged */ }
  };
  return <div className="effect-card"><StateEffectHeader effect={effect} title="Set Image" collapsed={collapsed} onCollapsed={() => setCollapsed((value) => !value)} onSave={onSave} onChange={onChange} onDelete={onDelete} />{!collapsed && <div className="form-grid"><StateActionSelect value={effect.action} onChange={onActionChange} /><StateTarget effect={effect} items={items} description="Image item whose artwork changes when the threshold is crossed." onChange={onChange} /><div className="wide"><Label>Replacement image</Label><button className="wide-button" type="button" onClick={() => void chooseImage()}>{effect.asset ? `Change ${effect.asset.name}` : "Choose from Owlbear…"}</button>{!effect.asset && <small className="field-hint">Choose an Owlbear image before this effect can run.</small>}</div><label className="checkbox-field wide"><Label>Constrain to original size</Label><span className="toggle"><input type="checkbox" aria-label="Constrain replacement image to original size" checked={effect.constrainToOriginalSize} onChange={(event) => onChange((value) => ({ ...value, constrainToOriginalSize: event.target.checked }))} /></span></label><label className="checkbox-field wide"><Label>Reverse on threshold exit</Label><span className="toggle"><input type="checkbox" aria-label="Restore original image on threshold exit" checked={effect.reverseOnExit} onChange={(event) => onChange((value) => ({ ...value, reverseOnExit: event.target.checked }))} /></span></label></div>}</div>;
}

function EmitterEffectEditor({ effect, items, onSave, onActionChange, onChange, onDelete }: StateEditorProps<Extract<MechanicalEffectDefinitionV1, { action: "emitter" }>>) {
  const [collapsed, setCollapsed] = useState(false);
  return <div className="effect-card"><StateEffectHeader effect={effect} title="Add/Remove Emitter" collapsed={collapsed} onCollapsed={() => setCollapsed((value) => !value)} onSave={onSave} onChange={onChange} onDelete={onDelete} />{!collapsed && <div className="form-grid"><StateActionSelect value={effect.action} onChange={onActionChange} /><StateTarget effect={effect} items={items} description="Scene item whose Sting emitter strings change when the threshold is crossed." onChange={onChange} /><label><Label>On threshold entry</Label><select value={effect.operation} onChange={(event) => onChange((value) => ({ ...value, operation: event.target.value as "add" | "remove" | "toggle" }))}><option value="add">Add emitter</option><option value="remove">Remove emitter</option><option value="toggle">Toggle emitter</option></select></label><label><Label>Emitter string</Label><input value={effect.signal} placeholder="signal or signal[range]" onChange={(event) => onChange((value) => ({ ...value, signal: event.target.value }))} /></label><label className="checkbox-field wide"><Label>Reverse on threshold exit</Label><span className="toggle"><input type="checkbox" aria-label="Reverse emitter change on threshold exit" checked={effect.reverseOnExit} onChange={(event) => onChange((value) => ({ ...value, reverseOnExit: event.target.checked }))} /></span></label></div>}</div>;
}

function EffectEditor({ effect, items, party, onSave, onChange, onDelete }: { effect: ShaderEffectDefinitionV1; items: Item[]; party: Player[]; onSave: () => void; onChange: (update: (effect: ShaderEffectDefinitionV1) => ShaderEffectDefinitionV1) => void; onDelete: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [animationOpen, setAnimationOpen] = useState(effect.animation?.mode !== "none" && effect.animation !== undefined);
  const geometry = resolveShaderGeometry(effect);
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  const setAudience = (type: EffectAudienceV1["type"]) => onChange((value) => ({ ...value, audience: type === "specific-users" ? { type, userIds: [] } : { type } }));
  type GeometryNumberField = "offsetX" | "offsetY" | "responsiveOffset" | "innerRadius" | "outerRadius" | "width" | "height" | "rotation";
  const setGeometry = (field: GeometryNumberField, value: number) => onChange((current) => ({ ...current, geometry: { ...resolveShaderGeometry(current), [field]: value } }));
  const setAnimation = (update: Partial<NonNullable<ShaderEffectDefinitionV1["animation"]>>) => onChange((current) => ({ ...current, animation: { mode: "none", rate: 1, depth: 0.35, radialDirection: "outward", waveWidth: 0.22, ...current.animation, ...update } }));
  const legacyRange = (value: number, link: StrengthLinkDirection | undefined, min: number, max: number): DynamicValueRange | undefined => link ? { minimum: link === "max" ? min : max, maximum: value } : undefined;
  const rangeFor = (field: ShaderDynamicField, fallback?: DynamicValueRange) => effect.dynamicRanges?.[field] ?? fallback;
  const setDynamicRange = (field: ShaderDynamicField, range: DynamicValueRange) => onChange((current) => ({ ...current, dynamicRanges: { ...current.dynamicRanges, [field]: range } }));
  const defaultTitle = effectDefaultName(effect);
  const title = effect.name ?? defaultTitle;
  return <div className="effect-card"><div className="section-title"><div className="card-heading-main"><button className="collapse-button" title={collapsed ? "Expand effect" : "Collapse effect"} aria-label={collapsed ? `Expand ${title} effect` : `Collapse ${title} effect`} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}><CaretIcon collapsed={collapsed} /></button><EditableTitle value={effect.name} fallback={defaultTitle} ariaLabel={`Rename ${defaultTitle} effect`} onChange={(name) => onChange((value) => ({ ...value, name }))} /></div><div className="effect-header-actions"><button className="mini-icon" title="Save this effect to your browser-local library." aria-label="Save effect to library" onClick={onSave}><SaveToBookIcon /></button><label className="toggle" title="Enable or disable this effect."><input type="checkbox" aria-label={`Enable ${title} effect`} checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /></label><button className="mini-icon danger delete-icon" title="Delete effect" aria-label={`Delete ${title} effect`} onClick={onDelete}><TrashIcon /></button></div></div>{!collapsed && <><div className="form-grid">
    <div className="paired-controls wide"><label title="Choose the native visual treatment."><Label tooltip="Choose the native visual treatment.">Preset</Label><select value={effect.preset} onChange={(event) => onChange((value) => { const preset = event.target.value as ShaderEffectDefinitionV1["preset"]; return { ...value, preset, geometry: DEFAULT_GEOMETRY[preset] }; })}><option value="glow">Glow/Shadow</option><option value="beam">Directional beam</option></select></label><label title="Scene item that receives the effect."><Label tooltip="Scene item that receives the effect.">Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Self</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter(s)</option><option value="specific-item">Specific item</option></select></label></div>
    <div className="paired-controls wide"><label title="Players who can see this effect."><Label tooltip="Players who can see this effect.">Audience</Label><select value={effect.audience.type} onChange={(event) => setAudience(event.target.value as EffectAudienceV1["type"])}><option value="everyone">Everyone</option><option value="gm">GM only</option><option value="players">Players</option><option value="detector-owner">Detector owner</option><option value="carrier-owner">Carrier owner</option><option value="target-owner">Target owner</option><option value="specific-users">Specific users</option></select></label><label className="checkbox-field" title="Show this effect to every GM in addition to the selected audience."><Label tooltip="Show this effect to every GM in addition to the selected audience.">Always include GM</Label><span className="toggle"><input type="checkbox" aria-label="Always include GM" checked={effect.alwaysIncludeGm ?? false} onChange={(event) => onChange((value) => ({ ...value, alwaysIncludeGm: event.target.checked }))} /></span></label></div>
    <div className="paired-controls wide"><label title="Choose the shader boundary shape."><Label tooltip="Choose the shader boundary shape.">Shape</Label><select value={effect.shape} onChange={(event) => onChange((value) => ({ ...value, shape: event.target.value as ShaderEffectDefinitionV1["shape"] }))}><option value="circle">Circle</option><option value="square">Square</option></select></label><label title="Draw the shader immediately above or below its target on the same scene layer."><Label tooltip="Draw the shader immediately above or below its target on the same scene layer.">Placement</Label><select value={effect.placement} onChange={(event) => onChange((value) => ({ ...value, placement: event.target.value as ShaderEffectDefinitionV1["placement"] }))}><option value="above">Above target</option><option value="below">Below target</option></select></label></div>
    {effect.target.type === "specific-item" && <label className="wide" title="Exact scene item to target."><Label tooltip="Exact scene item to target.">Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
    <div title="Effect color. Enable Gradient to blend from a minimum-strength color to the configured full-strength color."><ToggleOptionLabel label="Color" option="Gradient" active={effect.colorGradient !== undefined} activeTitle="Disable the signal-strength color gradient." inactiveTitle="Blend between minimum- and maximum-strength colors." onChange={(active) => onChange((value) => ({ ...value, colorGradient: active ? { minColor: "#000000" } : undefined }))} />{effect.colorGradient ? <div className="gradient-color-control" style={{ background: `linear-gradient(90deg, ${effect.colorGradient.minColor}, ${effect.color})` }}><input type="color" aria-label="Minimum-strength color" value={effect.colorGradient.minColor} onChange={(event) => onChange((value) => ({ ...value, colorGradient: { minColor: event.target.value } }))} /><input type="color" aria-label="Maximum-strength color" value={effect.color} onChange={(event) => onChange((value) => ({ ...value, color: event.target.value }))} /></div> : <input type="color" aria-label="Effect color" value={effect.color} onChange={(event) => onChange((value) => ({ ...value, color: event.target.value }))} />}</div>
    <DynamicSliderNumber tooltip="Effect opacity at minimum and maximum signal strength." label="Intensity" min={0} max={2} step={0.05} decimals={2} value={effect.maxIntensity} range={rangeFor("intensity", (effect.intensityStrengthLinked ?? true) ? { minimum: 0, maximum: effect.maxIntensity } : undefined)} onChange={(maxIntensity) => onChange((value) => ({ ...value, maxIntensity }))} onRangeChange={(range) => setDynamicRange("intensity", range)} />
    <DynamicSliderNumber tooltip="Feathering at the inner and outer edges." label="Softness" min={0.05} max={4} step={0.05} decimals={2} value={effect.spread} range={rangeFor("softness", legacyRange(effect.spread, effect.spreadStrengthLink, 0.05, 4))} onChange={(spread) => onChange((value) => ({ ...value, spread }))} onRangeChange={(range) => setDynamicRange("softness", range)} />
    {effect.preset === "beam" ? <div className="paired-controls wide"><DynamicSliderNumber tooltip="Radial distance where the beam begins; 100% is the target edge." label="Beam start" range={rangeFor("innerRadius", legacyRange(geometry.innerRadius, geometry.innerRadiusStrengthLink, 0, Math.max(0, geometry.outerRadius - 1)))} min={0} max={Math.max(0, geometry.outerRadius - 1)} step={1} value={geometry.innerRadius} suffix="%" onChange={(value) => setGeometry("innerRadius", value)} onRangeChange={(range) => setDynamicRange("innerRadius", range)} /><DynamicSliderNumber tooltip="Radial distance where the beam ends; 100% is the target edge." label="Beam end" range={rangeFor("outerRadius", legacyRange(geometry.outerRadius, geometry.outerRadiusStrengthLink, geometry.innerRadius + 1, 200))} min={geometry.innerRadius + 1} max={200} step={1} value={geometry.outerRadius} suffix="%" onChange={(value) => setGeometry("outerRadius", value)} onRangeChange={(range) => setDynamicRange("outerRadius", range)} /></div> : <><DynamicSliderNumber tooltip="Inner edge of the glow; 100% is the target edge." label="Inner radius" range={rangeFor("innerRadius", legacyRange(geometry.innerRadius, geometry.innerRadiusStrengthLink, 0, Math.max(0, geometry.outerRadius - 1)))} min={0} max={Math.max(0, geometry.outerRadius - 1)} step={1} value={geometry.innerRadius} suffix="%" onChange={(value) => setGeometry("innerRadius", value)} onRangeChange={(range) => setDynamicRange("innerRadius", range)} /><DynamicSliderNumber tooltip="Outer edge of the glow; 100% is the target edge." label="Outer radius" range={rangeFor("outerRadius", legacyRange(geometry.outerRadius, geometry.outerRadiusStrengthLink, geometry.innerRadius + 1, 200))} min={geometry.innerRadius + 1} max={200} step={1} value={geometry.outerRadius} suffix="%" onChange={(value) => setGeometry("outerRadius", value)} onRangeChange={(range) => setDynamicRange("outerRadius", range)} /></>}
    {effect.preset === "beam" && <DynamicSliderNumber className="wide" tooltip="Angular width of the directional beam." label="Beam width" range={rangeFor("beamWidth", legacyRange(effect.beamWidth ?? 38, effect.beamWidthStrengthLink, 5, 120))} min={5} max={120} step={1} value={effect.beamWidth ?? 38} suffix="°" onChange={(beamWidth) => onChange((value) => ({ ...value, beamWidth }))} onRangeChange={(range) => setDynamicRange("beamWidth", range)} />}
    <details className="advanced-section wide"><summary>Advanced</summary><div className="advanced-grid">
      <DynamicSliderNumber tooltip="Horizontal scale of the effect; 100% matches the target width." label="Width" range={rangeFor("width", legacyRange(geometry.width, geometry.widthStrengthLink, 5, 400))} min={5} max={400} step={1} value={geometry.width} suffix="%" onChange={(value) => setGeometry("width", value)} onRangeChange={(range) => setDynamicRange("width", range)} />
      <DynamicSliderNumber tooltip="Vertical scale of the effect; 100% matches the target height." label="Height" range={rangeFor("height", legacyRange(geometry.height, geometry.heightStrengthLink, 5, 400))} min={5} max={400} step={1} value={geometry.height} suffix="%" onChange={(value) => setGeometry("height", value)} onRangeChange={(range) => setDynamicRange("height", range)} />
      <DynamicSliderNumber tooltip="Move the effect center horizontally as a percentage of target size." label="X offset" range={rangeFor("offsetX", legacyRange(geometry.offsetX, geometry.offsetXStrengthLink, -100, 100))} min={-100} max={100} step={1} value={geometry.offsetX} suffix="%" onChange={(value) => setGeometry("offsetX", value)} onRangeChange={(range) => setDynamicRange("offsetX", range)} />
      <DynamicSliderNumber tooltip="Move the effect center vertically as a percentage of target size." label="Y offset" range={rangeFor("offsetY", legacyRange(geometry.offsetY, geometry.offsetYStrengthLink, -100, 100))} min={-100} max={100} step={1} value={geometry.offsetY} suffix="%" onChange={(value) => setGeometry("offsetY", value)} onRangeChange={(range) => setDynamicRange("offsetY", range)} />
      {effect.preset === "glow" && <DynamicSliderNumber className="wide" tooltip="Move the glow toward detected emitters with positive values or away with negative values; all-in-range detections use their average direction vector. This compounds with X and Y offset." label="Responsive offset" range={rangeFor("responsiveOffset")} min={-100} max={100} step={1} value={geometry.responsiveOffset} suffix="%" onChange={(value) => setGeometry("responsiveOffset", value)} onRangeChange={(range) => setDynamicRange("responsiveOffset", range)} />}
      <DynamicSliderNumber className="wide" tooltip={effect.preset === "beam" ? "Rotation offset from the automatically detected direction." : "Clockwise rotation of the effect's local axes."} label="Rotation" range={rangeFor("rotation", legacyRange(geometry.rotation, geometry.rotationStrengthLink, -180, 180))} min={-180} max={180} step={1} value={geometry.rotation} suffix="°" onChange={(value) => setGeometry("rotation", value)} onRangeChange={(range) => setDynamicRange("rotation", range)} />
    </div></details>
    <details className="animation-section wide" open={animationOpen} onToggle={(event) => setAnimationOpen(event.currentTarget.open)}><summary>Animation <small>{effect.animation?.mode ?? "none"}</small></summary><div className="animation-grid">
      <label title="Choose how effect intensity changes over time."><Label tooltip="Choose how effect intensity changes over time.">Mode</Label><select value={effect.animation?.mode ?? "none"} onChange={(event) => setAnimation({ mode: event.target.value as NonNullable<ShaderEffectDefinitionV1["animation"]>["mode"] })}><option value="none">None</option><option value="pulse">Pulse</option><option value="flicker">Flicker</option><option value="radial-pulse">Radial pulse</option></select></label>
      {effect.animation?.mode === "radial-pulse" && <label title="Direction the radial pulse travels."><Label tooltip="Direction the radial pulse travels.">Direction</Label><select value={effect.animation.radialDirection ?? "outward"} onChange={(event) => setAnimation({ radialDirection: event.target.value as "outward" | "inward" })}><option value="outward">Outward</option><option value="inward">Inward</option></select></label>}
      {(effect.animation?.mode ?? "none") !== "none" && <><DynamicSliderNumber tooltip="Animation cycles per second." label="Rate" range={rangeFor("animationRate", legacyRange(effect.animation?.rate ?? 1, effect.animation?.rateStrengthLink, 0, 10))} min={0} max={10} step={0.1} decimals={1} value={effect.animation?.rate ?? 1} onChange={(rate) => setAnimation({ rate })} onRangeChange={(range) => setDynamicRange("animationRate", range)} /><DynamicSliderNumber tooltip="Difference between the dim and bright animation phases." label="Depth" range={rangeFor("animationDepth", legacyRange(effect.animation?.depth ?? 0.35, effect.animation?.depthStrengthLink, 0, 1))} min={0} max={1} step={0.05} decimals={2} value={effect.animation?.depth ?? 0.35} onChange={(depth) => setAnimation({ depth })} onRangeChange={(range) => setDynamicRange("animationDepth", range)} /></>}
      {effect.animation?.mode === "radial-pulse" && <DynamicSliderNumber className="wide" tooltip="Thickness of the traveling radial band." label="Wave width" range={rangeFor("waveWidth", legacyRange(effect.animation.waveWidth ?? 0.22, effect.animation.waveWidthStrengthLink, 0.05, 1))} min={0.05} max={1} step={0.05} decimals={2} value={effect.animation.waveWidth ?? 0.22} onChange={(waveWidth) => setAnimation({ waveWidth })} onRangeChange={(range) => setDynamicRange("waveWidth", range)} />}
    </div></details>
  </div>{effect.audience.type === "specific-users" && <fieldset><legend>Specific users</legend>{party.length ? party.map((player) => <label className="user-check" key={player.id}><input type="checkbox" checked={effect.audience.type === "specific-users" && effect.audience.userIds.includes(player.id)} onChange={(event) => onChange((value) => { const audience = value.audience.type === "specific-users" ? value.audience : { type: "specific-users" as const, userIds: [] }; return { ...value, audience: { ...audience, userIds: event.target.checked ? [...audience.userIds, player.id] : audience.userIds.filter((id) => id !== player.id) } }; })} />{player.name} <small>{player.role}</small></label>) : <p className="muted">No connected users. Stored offline IDs are retained.</p>}</fieldset>}</>}</div>;
}

interface DebugViewProps { rules: DebugRuleState[]; authority: SharedAuthoritySnapshot | null; pending: boolean; error: string | null; onTakeControl: () => void; onReleaseControl: () => void }

export function AuthorityCard({ authority, pending, error, onTakeControl, onReleaseControl }: Omit<DebugViewProps, "rules">) {
  const authorityLabel = !authority ? "Connecting" : authority.state === "active" ? "Active" : authority.state === "standby" ? "Standby" : authority.state === "discovering" ? "Discovering" : "Not eligible";
  return <div className={`authority-card authority-${authority?.state ?? "discovering"}`}><div className="authority-heading"><strong>Shared-effect authority</strong><span>{authorityLabel}</span></div><p>{authority?.state === "active" ? "This session executes shared state and integration effects." : authority?.state === "standby" ? "Another healthy GM session is executing shared effects." : authority?.state === "discovering" ? "Checking for other healthy Sting runtimes…" : "Only GM sessions can execute shared effects."}</p>{authority && <small>{authority.healthyRuntimeCount} healthy GM runtime{authority.healthyRuntimeCount === 1 ? "" : "s"} · {authority.selection} selection</small>}{authority?.state === "standby" && <button className="wide-button" disabled={pending} onClick={onTakeControl}>{pending ? "Taking control…" : "Take control"}</button>}{authority?.state === "active" && authority.manualClaimedByLocal && <button className="wide-button" disabled={pending} onClick={onReleaseControl}>{pending ? "Returning…" : "Return to automatic"}</button>}{error && <div className="validation-error" role="alert">{error}</div>}</div>;
}

function DebugView({ rules, authority, pending, error, onTakeControl, onReleaseControl }: DebugViewProps) {
  return <section className="content-card debug-view"><h2>Local runtime</h2><p className="muted">Derived state from this client only. Nothing here is stored in scene metadata.</p><AuthorityCard authority={authority} pending={pending} error={error} onTakeControl={onTakeControl} onReleaseControl={onReleaseControl} />{rules.length === 0 ? <div className="notice">No active detector rules.</div> : rules.map((rule) => <article key={`${rule.detectorId}:${rule.ruleId}`}><h3>{rule.detectorName}</h3><code>{rule.signal} · {rule.aggregation === "all" ? "all in range" : "closest"} · {rule.range.outer}</code><dl className="facts"><div><dt>Matches</dt><dd>{rule.matchingEmitterCount}</dd></div><div><dt>Active</dt><dd>{rule.activeEmitterCount}</dd></div></dl>{rule.detections.map((detection, index) => <div className="debug-detection" key={`${detection.emitterName}:${index}`}><strong>{detection.emitterName}</strong><span>{detection.distance.toFixed(2)} · strength {detection.strength.toFixed(3)}</span></div>)}{rule.effects.map((effect, index) => <div className="debug-effect" key={`${effect.effectId}:${effect.runtimeKey ?? index}`}><strong>{effect.providerId ? `${effect.providerId} · ${effect.actionId}` : effect.actionId ? `${effect.type === "mechanical" ? "state" : effect.type} · ${effect.actionId}` : effect.type === "mechanical" ? "state" : effect.type} · {effect.lifecycle}</strong><span>{effect.transition} · {effect.targetType} → {effect.targetName ?? "unresolved"}</span><span>{effect.audience ?? "GM authority"} · {effect.audienceMatch ? "execution client" : "not executing here"}</span><code>{effect.executionStatus ?? effect.localItemId ?? "inactive"}</code></div>)}</article>)}</section>;
}
