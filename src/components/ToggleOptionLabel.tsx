interface ToggleOptionLabelProps {
  label: string;
  option: string;
  active: boolean;
  onChange: (active: boolean) => void;
  activeTitle: string;
  inactiveTitle: string;
}

export function ToggleOptionLabel({ label, option, active, onChange, activeTitle, inactiveTitle }: ToggleOptionLabelProps) {
  return <span className="field-label strength-link-label">
    {label} (<button type="button" className={`strength-link-option${active ? " active" : ""}`} aria-pressed={active} title={active ? activeTitle : inactiveTitle} onClick={() => onChange(!active)}>{option}</button>)
  </span>;
}
