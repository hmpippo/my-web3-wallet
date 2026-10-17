"use client";

interface ToggleSwitchProps {
  /** Whether the switch is on. */
  checked: boolean;
  /** Called with the next checked value when the user flips the switch. */
  onChange: (checked: boolean) => void;
  /** Accessible name, e.g. "Hide USDC". */
  label: string;
  disabled?: boolean;
}

/** A small on/off switch (iOS-style track + knob) used for token visibility. */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: ToggleSwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="toggle-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" className="toggle-switch-knob" />
    </button>
  );
}
