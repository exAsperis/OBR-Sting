import type { Layer } from "@owlbear-rodeo/sdk";

interface LayerCheckboxDropdownProps {
  layers: Layer[];
  value: Layer[];
  className?: string;
  onChange: (layers: Layer[]) => void;
}

export function LayerCheckboxDropdown({ layers, value, className, onChange }: LayerCheckboxDropdownProps) {
  const toggle = (layer: Layer, checked: boolean) => {
    onChange(checked ? [...value, layer] : value.filter((candidate) => candidate !== layer));
  };

  return <div className={`layer-dropdown-field${className ? ` ${className}` : ""}`}>
    <span className="field-label">Ignore layers</span>
    <details className="layer-dropdown">
      <summary>{value.length} {value.length === 1 ? "layer" : "layers"} ignored</summary>
      <div className="layer-dropdown-options">
        {layers.map((layer) => <label key={layer}>
          <input type="checkbox" checked={value.includes(layer)} onChange={(event) => toggle(layer, event.target.checked)} />
          <span>{layer.replaceAll("_", " ")}</span>
        </label>)}
      </div>
    </details>
  </div>;
}
