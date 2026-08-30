interface DynamicRangeLabelProps {
  label: string;
  dynamic: boolean;
  onDynamicChange: (active: boolean) => void;
}

export function DynamicRangeLabel({ label, dynamic, onDynamicChange }: DynamicRangeLabelProps) {
  return <span className="field-label strength-link-label">
    {label} (<button type="button" className={`strength-link-option${dynamic ? " active" : ""}`} aria-pressed={dynamic} title={dynamic ? "Use one constant responsive offset." : "Use separate offsets at minimum and maximum detection strength."} onClick={() => onDynamicChange(!dynamic)}>DYN</button>)
  </span>;
}
