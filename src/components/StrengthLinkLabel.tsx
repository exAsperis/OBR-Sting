import type { StrengthLinkDirection } from "../types";

interface StrengthLinkLabelProps {
  label: string;
  value?: StrengthLinkDirection;
  onChange: (value: StrengthLinkDirection | undefined) => void;
}

export function StrengthLinkLabel({ label, value, onChange }: StrengthLinkLabelProps) {
  const option = (direction: StrengthLinkDirection) => {
    const active = value === direction;
    const endpoint = direction === "min" ? "maximum" : "minimum";
    return <button
      type="button"
      className={`strength-link-option${active ? " active" : ""}`}
      aria-pressed={active}
      title={active
        ? `Stop linking ${label} to signal strength.`
        : `At minimum signal strength, use the configurable ${endpoint}; at full strength, use the configured value.`}
      onClick={() => onChange(active ? undefined : direction)}
    >{direction.toUpperCase()}</button>;
  };

  return <span className="field-label strength-link-label">
    {label} ({option("min")}<span aria-hidden="true"> | </span>{option("max")})
  </span>;
}
