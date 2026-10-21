"use client";

import { useSyncExternalStore } from "react";
import { type ThemeMode } from "@/lib/theme";
import { getServerThemeState, themeService } from "@/services/theme-service";

const OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "System" },
];

interface ThemeOptionsProps {
  /** Called after a mode is chosen, so a surrounding panel can close. */
  onSelect?: () => void;
}

/**
 * Light / dark / follow-system choices for the global settings menu.
 *
 * Styled as a radio group rather than a nested menu, because the settings
 * panel is a plain disclosure and a menu inside it would be confusing to
 * navigate.
 */
export function ThemeOptions({ onSelect }: ThemeOptionsProps) {
  const { mode } = useSyncExternalStore(
    themeService.subscribe,
    themeService.getState,
    getServerThemeState,
  );

  return (
    <div aria-label="Theme" className="theme-options" role="radiogroup">
      {OPTIONS.map((option) => (
        <button
          aria-checked={mode === option.mode}
          className="theme-option"
          key={option.mode}
          onClick={() => {
            themeService.setMode(option.mode);
            onSelect?.();
          }}
          role="radio"
          type="button"
        >
          <span className="theme-option-icon">
            <ModeIcon mode={option.mode} />
          </span>
          {option.label}
          {mode === option.mode ? (
            <span aria-hidden="true" className="theme-option-check">
              <svg
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 16 16"
              >
                <path d="M3.5 8.4l2.7 2.7 6.3-6.4" />
              </svg>
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function ModeIcon({ mode }: { mode: ThemeMode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
    >
      {mode === "light" ? (
        <>
          <circle cx="8" cy="8" r="2.8" />
          <path d="M8 1.4v1.6M8 13v1.6M1.4 8H3M13 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
        </>
      ) : mode === "dark" ? (
        <path d="M13.3 9.5A5.6 5.6 0 0 1 6.5 2.7a5.6 5.6 0 1 0 6.8 6.8z" />
      ) : (
        <>
          <rect height="7.6" rx="1.2" width="12" x="2" y="2.7" />
          <path d="M6 13.6h4M8 10.3v3.3" />
        </>
      )}
    </svg>
  );
}
