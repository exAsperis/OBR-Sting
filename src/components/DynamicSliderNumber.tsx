import type { DynamicValueRange } from "../types";
import { DualSliderNumber } from "./DualSliderNumber";
import { DynamicRangeLabel } from "./DynamicRangeLabel";
import { SliderNumber } from "./SliderNumber";

interface DynamicSliderNumberProps {
  label: string;
  value: number;
  range?: DynamicValueRange;
  min: number;
  max: number;
  step: number;
  inputStep?: number;
  decimals?: number;
  suffix?: string;
  className?: string;
  tooltip?: string;
  onChange: (value: number) => void;
  onRangeChange: (range: DynamicValueRange) => void;
}

export function DynamicSliderNumber({ label, value, range, min, max, step, inputStep, decimals, suffix, className, tooltip, onChange, onRangeChange }: DynamicSliderNumberProps) {
  const dynamic = range !== undefined && range.enabled !== false;
  const labelContent = <DynamicRangeLabel label={label} dynamic={dynamic} onDynamicChange={(enabled) => {
    if (!enabled && range) {
      onChange(range.maximum);
      onRangeChange({ ...range, enabled: false });
    } else if (enabled) {
      onRangeChange({ minimum: range?.minimum ?? min, maximum: value });
    }
  }} />;
  return dynamic && range
    ? <DualSliderNumber label={label} labelContent={labelContent} minimumValue={range.minimum} maximumValue={range.maximum} min={min} max={max} step={inputStep ?? step} suffix={suffix} className={className} tooltip={tooltip} onChange={(minimum, maximum) => onRangeChange({ minimum, maximum })} />
    : <SliderNumber label={label} labelContent={labelContent} value={value} min={min} max={max} step={step} inputStep={inputStep} decimals={decimals} suffix={suffix} className={`${className ? `${className} ` : ""}discrete-slider`} tooltip={tooltip} editReplacesSlider onChange={onChange} />;
}
