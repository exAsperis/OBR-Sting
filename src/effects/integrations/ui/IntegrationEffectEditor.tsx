import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";
import type { EffectAudienceV1, EffectTargetV1, IntegrationEffectDefinitionV1, JsonValue, LightEffectDefinitionV1 } from "../../../types";
import { INTEGRATION_CATALOG, type ParameterField } from "../catalog";
import { SliderNumber } from "../../../components/SliderNumber";
import { CaretIcon, SaveToBookIcon, TrashIcon } from "../../../components/EditorIcons";
import { useEffect, useState } from "react";
import { EditableTitle } from "../../../components/EditableTitle";
import { RUMBLE_INTEGRATION_KEY } from "../../../constants";

const Label = ({ children, tooltip }: { children: React.ReactNode; tooltip?: string }) => <span className="field-label" title={tooltip}>{children}</span>;

export function IntegrationEffectEditor(props: {
  effect: IntegrationEffectDefinitionV1 | LightEffectDefinitionV1;
  items: Item[];
  providerEnabled: boolean;
  onSave: () => void;
  onChange: (update: (effect: any) => any) => void;
  onDelete: () => void;
}) {
  if (props.effect.type === "light") return <LightEffectEditor {...props} effect={props.effect} />;
  return <IntegrationEditorBody {...props} effect={props.effect} />;
}

function IntegrationEditorBody({ effect, items, providerEnabled, onSave, onChange, onDelete }: {
  effect: IntegrationEffectDefinitionV1;
  items: Item[];
  providerEnabled: boolean;
  onSave: () => void;
  onChange: (update: (effect: IntegrationEffectDefinitionV1) => IntegrationEffectDefinitionV1) => void;
  onDelete: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [party, setParty] = useState<Player[]>([]);
  const [rumbleEnabled, setRumbleEnabled] = useState(false);
  const provider = INTEGRATION_CATALOG.find((entry) => entry.id === effect.providerId);
  const action = provider?.actions.find((entry) => entry.id === effect.actionId);
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  const setParameter = (key: string, value: JsonValue) => onChange((current) => ({ ...current, parameters: { ...current.parameters, [key]: value } }));
  const setAudience = (type: EffectAudienceV1["type"]) => onChange((value) => ({ ...value, audience: type === "specific-users" ? { type, userIds: [] } : { type } }));
  const switchAction = (actionId: string) => {
    const next = provider?.actions.find((entry) => entry.id === actionId);
    if (!next) return;
    const audienceType = next.allowedAudiences.includes(effect.audience.type) ? effect.audience.type : next.allowedAudiences[0];
    onChange((current) => ({ ...current, actionId, lifecycle: next.allowedLifecycles[0], audience: audienceType === "specific-users" ? { type: audienceType, userIds: [] } : { type: audienceType }, parameters: { ...next.defaults } }));
  };
  useEffect(() => {
    void OBR.party.getPlayers().then(setParty);
    return OBR.party.onChange(setParty);
  }, []);
  useEffect(() => {
    if (effect.providerId !== "rumble") return;
    const apply = (metadata: Awaited<ReturnType<typeof OBR.scene.getMetadata>>) => setRumbleEnabled(metadata[RUMBLE_INTEGRATION_KEY] === true);
    void OBR.scene.getMetadata().then(apply);
    return OBR.scene.onMetadataChange(apply);
  }, [effect.providerId]);
  const integrationEnabled = effect.providerId === "rumble" ? rumbleEnabled : providerEnabled;

  return <div className="effect-card emanation-card">
    <div className="section-title"><div className="card-heading-main"><button className="collapse-button" title={collapsed ? "Expand effect" : "Collapse effect"} aria-label={collapsed ? "Expand integration effect" : "Collapse integration effect"} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}><CaretIcon collapsed={collapsed} /></button><EditableTitle value={effect.name} fallback={`${provider?.displayName ?? effect.providerId} · ${action?.displayName ?? effect.actionId}`} ariaLabel="Rename integration effect" onChange={(name) => onChange((value) => ({ ...value, name }))} /></div><div className="effect-header-actions"><button className="mini-icon" title="Save this effect to your browser-local library." aria-label="Save effect to library" onClick={onSave}><SaveToBookIcon /></button><label className="toggle" title="Enable or disable this effect."><input type="checkbox" aria-label="Enable integration effect" checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /></label><button className="mini-icon danger delete-icon" title="Delete effect" aria-label="Delete integration effect" onClick={onDelete}><TrashIcon /></button></div></div>
    {!collapsed && <>
    {!integrationEnabled && <p className="validation-error" role="status">Extension unavailable or unverified. Configuration is retained and execution is skipped while this integration is disabled.</p>}
    {(!provider || !action) && <p className="validation-error" role="status">This Sting build does not include the configured provider action. Configuration is retained.</p>}
    <div className="form-grid">
      <label title="Integration that executes this effect."><Label tooltip="Integration that executes this effect.">Provider</Label><input value={provider?.displayName ?? effect.providerId} readOnly /></label>
      <label title="Integration operation to execute."><Label tooltip="Integration operation to execute.">Action</Label><select value={effect.actionId} onChange={(event) => switchAction(event.target.value)}>{provider?.actions.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>) ?? <option value={effect.actionId}>{effect.actionId}</option>}</select></label>
      <label title="Detection transition that executes this action."><Label tooltip="Detection transition that executes this action.">Lifecycle</Label><select value={effect.lifecycle} onChange={(event) => onChange((value) => ({ ...value, lifecycle: event.target.value as IntegrationEffectDefinitionV1["lifecycle"] }))}>{(action?.allowedLifecycles ?? [effect.lifecycle]).map((lifecycle) => <option key={lifecycle} value={lifecycle}>{lifecycle}</option>)}</select></label>
      <label title="Scene item passed to the integration."><Label tooltip="Scene item passed to the integration.">Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Self</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter(s)</option><option value="specific-item">Specific item</option></select></label>
      {effect.target.type === "specific-item" && <label className="wide" title="Exact scene item passed to the integration."><Label tooltip="Exact scene item passed to the integration.">Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
      <label className="wide" title="Rumble delivery audience."><Label tooltip="Rumble delivery audience.">Audience</Label><select value={effect.audience.type} onChange={(event) => setAudience(event.target.value as EffectAudienceV1["type"])}>{(action?.allowedAudiences ?? [effect.audience.type]).map((type) => <option key={type} value={type}>{type === "everyone" ? "Everyone" : type === "gm" ? "GM only" : type === "players" ? "Players" : type === "detector-owner" ? "Detector owner" : type === "carrier-owner" ? "Carrier owner" : type === "target-owner" ? "Target owner" : "Specific users"}</option>)}</select></label>
      {effect.audience.type === "specific-users" && <fieldset className="wide"><legend>Specific users</legend>{party.length ? party.map((player) => <label className="user-check" key={player.id}><input type="checkbox" checked={effect.audience.type === "specific-users" && effect.audience.userIds.includes(player.id)} onChange={(event) => onChange((value) => { const audience = value.audience.type === "specific-users" ? value.audience : { type: "specific-users" as const, userIds: [] }; return { ...value, audience: { ...audience, userIds: event.target.checked ? [...audience.userIds, player.id] : audience.userIds.filter((id) => id !== player.id) } }; })} />{player.name} <small>{player.role}</small></label>) : <p className="muted">No connected users. Stored offline IDs are retained.</p>}</fieldset>}
      {action?.parameters.map((field) => <ParameterInput key={field.key} field={field} value={effect.parameters[field.key]} onChange={(value) => setParameter(field.key, value)} />)}
    </div>
    {action?.warning && <p className="field-hint">Warning: {action.warning}</p>}
    </>}
  </div>;
}

export function LightEffectEditor({ effect, onSave, onChange, onDelete }: { effect: LightEffectDefinitionV1; onSave: () => void; onChange: (update: (effect: LightEffectDefinitionV1) => LightEffectDefinitionV1) => void; onDelete: () => void; items: Item[]; providerEnabled: boolean }) {
  const title = effect.action === "add" ? "Add Light" : "Modify Light";
  return <div className="effect-card"><div className="section-title"><EditableTitle value={effect.name} fallback={title} ariaLabel={`Rename ${title}`} onChange={(name) => onChange((value) => ({ ...value, name }))} /><div className="effect-header-actions"><button className="mini-icon" onClick={onSave}><SaveToBookIcon /></button><label className="toggle"><input type="checkbox" aria-label={`Enable ${title}`} checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /></label><button className="mini-icon danger" onClick={onDelete}><TrashIcon /></button></div></div><div className="form-grid">
    <label className="wide"><Label>Light action</Label><select value={effect.action} onChange={(event) => onChange((value) => ({ ...value, action: event.target.value as "add" | "modify", target: event.target.value === "modify" ? { type: "detected-emitter" } : { type: "detector" } }))}><option value="add">Add Light</option><option value="modify">Modify Detected Light</option></select></label>
    {effect.action === "add" && <label className="wide" title="Permanent lights remain after the trigger clears, until Sting or the scene runtime is reset."><Label>Duration</Label><select value={effect.duration ?? "temporary"} onChange={(event) => onChange((value) => ({ ...value, duration: event.target.value as "temporary" | "permanent" }))}><option value="temporary">Temporary — remove when trigger clears</option><option value="permanent">Permanent — keep after trigger clears</option></select></label>}
    {effect.action === "modify" && <label><Label>Radius operation</Label><select value={effect.radiusOperation ?? "set"} onChange={(event) => onChange((value) => ({ ...value, radiusOperation: event.target.value as "set" | "add" | "multiply" }))}><option value="set">Set</option><option value="add">Add</option><option value="multiply">Multiply</option></select></label>}
    <SliderNumber className="wide" label={effect.radiusOperation === "multiply" ? "Radius multiplier" : "Radius (scene units)"} min={0} max={effect.radiusOperation === "multiply" ? 5 : 60} step={0.1} value={effect.attenuationRadius.value} onChange={(value) => onChange((current) => ({ ...current, attenuationRadius: { ...current.attenuationRadius, value } }))} />
    <SliderNumber label="Source radius" min={0} max={60} step={0.5} value={effect.sourceRadius?.value ?? 0} onChange={(value) => onChange((current) => ({ ...current, sourceRadius: { value } }))} />
    <SliderNumber label="Falloff" min={0} max={2} step={0.05} value={effect.falloff?.value ?? 0.5} onChange={(value) => onChange((current) => ({ ...current, falloff: { value } }))} />
    <label className="wide"><Label>Light type</Label><select value={effect.lightType ?? "PRIMARY"} onChange={(event) => onChange((value) => ({ ...value, lightType: event.target.value as "PRIMARY" | "SECONDARY" | "AUXILIARY" }))}><option value="PRIMARY">Primary</option><option value="SECONDARY">Secondary</option><option value="AUXILIARY">Auxiliary</option></select></label>
    <details className="advanced-section wide"><summary>Cone / Direction</summary><div className="advanced-grid"><SliderNumber label="Inner angle" min={0} max={360} step={1} value={effect.innerAngle?.value ?? 360} suffix="°" onChange={(value) => onChange((current) => ({ ...current, innerAngle: { value } }))} /><SliderNumber label="Outer angle" min={0} max={360} step={1} value={effect.outerAngle?.value ?? 360} suffix="°" onChange={(value) => onChange((current) => ({ ...current, outerAngle: { value } }))} /></div></details>
  </div></div>;
}

function ParameterInput({ field, value, onChange }: { field: ParameterField; value: JsonValue | undefined; onChange: (value: JsonValue) => void }) {
  const tooltip = `Configure ${field.label.toLowerCase()} for this integration action.`;
  if (field.type === "boolean") return <label className="checkbox-field" title={tooltip}><Label tooltip={tooltip}>{field.label}</Label><span className="toggle"><input type="checkbox" aria-label={field.label} checked={value === true} onChange={(event) => onChange(event.target.checked)} /></span></label>;
  if (field.type === "number") return <SliderNumber tooltip={tooltip} label={field.label} min={field.min ?? 0} max={field.max} step={field.step ?? 1} value={typeof value === "number" ? value : 0} onChange={onChange} />;
  if (field.type === "select") return <label className="wide" title={tooltip}><Label tooltip={tooltip}>{field.label}</Label><select value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{field.warning && value === "remove-all-with-warning" && <small className="field-hint">Warning: {field.warning}</small>}</label>;
  return <label className="wide" title={tooltip}><Label tooltip={tooltip}>{field.label}</Label><input value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} /></label>;
}
