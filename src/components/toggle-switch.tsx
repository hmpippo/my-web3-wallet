"use client";

import type { Ref } from "react";

interface ToggleSwitchProps {
  /** Whether the switch is on. */
  checked: boolean;
  /** Called with the next checked value when the user flips the switch. */
  onChange: (checked: boolean) => void;
  /** Accessible name, e.g. "Hide USDC". */
  label: string;
  disabled?: boolean;
  /** Lets the caller return focus to the switch after closing a dialog. */
  switchRef?: Ref<HTMLButtonElement>;
}

/** A small on/off switch (iOS-style track + knob) used for token visibility. */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  switchRef,
}: ToggleSwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="toggle-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      ref={switchRef}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" className="toggle-switch-knob" />
    </button>
  );
}
