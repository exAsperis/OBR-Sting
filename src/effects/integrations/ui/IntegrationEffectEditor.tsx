import type { Item } from "@owlbear-rodeo/sdk";
import type { EffectTargetV1, IntegrationEffectDefinitionV1, JsonValue } from "../../../types";
import { INTEGRATION_CATALOG, type ParameterField } from "../catalog";
import { SliderNumber } from "../../../components/SliderNumber";

const Label = ({ children, tooltip }: { children: React.ReactNode; tooltip?: string }) => <span className="field-label" title={tooltip}>{children}</span>;

export function IntegrationEffectEditor({ effect, items, providerEnabled, onChange, onDelete }: {
  effect: IntegrationEffectDefinitionV1;
  items: Item[];
  providerEnabled: boolean;
  onChange: (update: (effect: IntegrationEffectDefinitionV1) => IntegrationEffectDefinitionV1) => void;
  onDelete: () => void;
}) {
  const provider = INTEGRATION_CATALOG.find((entry) => entry.id === effect.providerId);
  const action = provider?.actions.find((entry) => entry.id === effect.actionId);
  const setTarget = (type: EffectTargetV1["type"]) => onChange((value) => ({ ...value, target: type === "specific-item" ? { type, itemId: items[0]?.id ?? "" } : { type } }));
  const setParameter = (key: string, value: JsonValue) => onChange((current) => ({ ...current, parameters: { ...current.parameters, [key]: value } }));

  return <div className="effect-card emanation-card">
    <div className="section-title"><strong>{provider?.displayName ?? effect.providerId} · {action?.displayName ?? effect.actionId}</strong><label className="toggle"><input type="checkbox" checked={effect.enabled} onChange={(event) => onChange((value) => ({ ...value, enabled: event.target.checked }))} /> Enabled</label></div>
    {!providerEnabled && <p className="validation-error" role="status">Extension unavailable or unverified. Configuration is retained and execution is skipped while this integration is disabled.</p>}
    {(!provider || !action) && <p className="validation-error" role="status">This Sting build does not include the configured provider action. Configuration is retained.</p>}
    <div className="form-grid">
      <label title="Integration that executes this effect."><Label tooltip="Integration that executes this effect.">Provider</Label><input value={provider?.displayName ?? effect.providerId} readOnly /></label>
      <label title="Integration operation to execute."><Label tooltip="Integration operation to execute.">Action</Label><input value={action?.displayName ?? effect.actionId} readOnly /></label>
      <label title="Detection transition that executes this action."><Label tooltip="Detection transition that executes this action.">Lifecycle</Label><select value={effect.lifecycle} onChange={(event) => onChange((value) => ({ ...value, lifecycle: event.target.value as IntegrationEffectDefinitionV1["lifecycle"] }))}>{(action?.allowedLifecycles ?? [effect.lifecycle]).map((lifecycle) => <option key={lifecycle} value={lifecycle}>{lifecycle}</option>)}</select></label>
      <label title="Scene item passed to the integration."><Label tooltip="Scene item passed to the integration.">Target</Label><select value={effect.target.type} onChange={(event) => setTarget(event.target.value as EffectTargetV1["type"])}><option value="detector">Detector</option><option value="parent">Parent</option><option value="carrier">Carrier</option><option value="detected-emitter">Detected emitter</option><option value="specific-item">Specific item</option></select></label>
      {effect.target.type === "specific-item" && <label className="wide" title="Exact scene item passed to the integration."><Label tooltip="Exact scene item passed to the integration.">Specific item</Label><select value={effect.target.itemId} onChange={(event) => onChange((value) => ({ ...value, target: { type: "specific-item", itemId: event.target.value } }))}>{items.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>}
      {action?.parameters.map((field) => <ParameterInput key={field.key} field={field} value={effect.parameters[field.key]} onChange={(value) => setParameter(field.key, value)} />)}
    </div>
    <button className="danger text-button" onClick={onDelete}>Delete effect</button>
  </div>;
}

function ParameterInput({ field, value, onChange }: { field: ParameterField; value: JsonValue | undefined; onChange: (value: JsonValue) => void }) {
  const tooltip = `Configure ${field.label.toLowerCase()} for this integration action.`;
  if (field.type === "boolean") return <label title={tooltip}><Label tooltip={tooltip}>{field.label}</Label><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /></label>;
  if (field.type === "number") return <SliderNumber tooltip={tooltip} label={field.label} min={field.min ?? 0} max={field.max} step={field.step ?? 1} value={typeof value === "number" ? value : 0} onChange={onChange} />;
  if (field.type === "select") return <label className="wide" title={tooltip}><Label tooltip={tooltip}>{field.label}</Label><select value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{field.warning && value === "remove-all-with-warning" && <small className="field-hint">Warning: {field.warning}</small>}</label>;
  return <label className="wide" title={tooltip}><Label tooltip={tooltip}>{field.label}</Label><input value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} /></label>;
}
