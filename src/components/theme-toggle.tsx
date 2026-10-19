"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type ThemeMode } from "@/lib/theme";
import { getServerThemeState, themeService } from "@/services/theme-service";

const OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "System" },
];

const MODE_LABELS: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * Header control for the light / dark / follow-system preference.
 *
 * A single icon reflects the current mode; the menu spells out the three
 * choices and checkmarks the active one, so "follow system" is discoverable.
 * Styling reuses the overflow-menu classes to match the row menus.
 */
export function ThemeToggle() {
  const { mode } = useSyncExternalStore(
    themeService.subscribe,
    themeService.getState,
    getServerThemeState,
  );
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function choose(next: ThemeMode) {
    themeService.setMode(next);
    setIsOpen(false);
  }

  return (
    <div className="overflow-menu theme-switcher" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Theme: ${MODE_LABELS[mode]}. Change theme`}
        className="overflow-menu-trigger"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <ModeIcon mode={mode} />
      </button>
      {isOpen ? (
        <div
          aria-label="Theme"
          className="overflow-menu-dropdown theme-menu"
          role="menu"
        >
          {OPTIONS.map((option) => (
            <button
              aria-checked={mode === option.mode}
              className="overflow-menu-item"
              key={option.mode}
              onClick={() => choose(option.mode)}
              role="menuitemradio"
              type="button"
            >
              <span className="overflow-menu-icon">
                <ModeIcon mode={option.mode} />
              </span>
              {option.label}
              {mode === option.mode ? (
                <span aria-hidden="true" className="theme-menu-check">
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
      ) : null}
    </div>
  );
}

function ModeIcon({ mode }: { mode: ThemeMode }) {
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
