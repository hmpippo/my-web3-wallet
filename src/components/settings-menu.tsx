"use client";

import { useEffect, useRef, useState } from "react";
import { AddressBookDialog } from "@/components/address-book-dialog";

/**
 * Global settings gear in the site header.
 *
 * The panel is a plain disclosure panel rather than a menu because it hosts
 * actions and app-wide preferences. Network selection deliberately stays inline
 * in the header.
 */
export function SettingsMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [isAddressBookOpen, setIsAddressBookOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="settings-menu" ref={containerRef}>
      <button
        aria-controls="settings-menu-panel"
        aria-expanded={isOpen}
        aria-label="Settings"
        className="settings-menu-trigger"
        onClick={() => setIsOpen((open) => !open)}
        ref={triggerRef}
        type="button"
      >
        <GearIcon />
      </button>
      {isOpen ? (
        <div
          aria-label="Settings"
          className="settings-menu-panel"
          id="settings-menu-panel"
          role="group"
        >
          <section className="settings-menu-section">
            <h2>Settings</h2>
            <button
              className="settings-menu-item"
              onClick={() => {
                setIsOpen(false);
                setIsAddressBookOpen(true);
              }}
              type="button"
            >
              <BookIcon />
              <span>Address book</span>
              <ChevronIcon />
            </button>
          </section>
        </div>
      ) : null}
      {isAddressBookOpen ? (
        <AddressBookDialog
          onClose={() => setIsAddressBookOpen(false)}
          returnFocusRef={triggerRef}
        />
      ) : null}
    </div>
  );
}

function GearIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
    >
      <path d="M3 2.5h8.5a1.5 1.5 0 0 1 1.5 1.5v9.5H4.5A1.5 1.5 0 0 1 3 12V2.5z" />
      <path d="M3 11.5h10M5.8 5.2h4.4M5.8 7.6h2.8" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      className="settings-menu-chevron"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}
