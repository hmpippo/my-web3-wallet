"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface OverflowMenuItem {
  label: string;
  /** Runs the action and closes the menu. */
  onClick?: () => void;
  /** Navigates and closes the menu. Takes precedence over `onClick`. */
  href?: string;
}

interface OverflowMenuProps {
  /** Accessible name for the trigger and the menu. */
  label: string;
  items: readonly OverflowMenuItem[];
}

/** A hamburger button that opens a small list of actions or links. */
export function OverflowMenu({ label, items }: OverflowMenuProps) {
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

  return (
    <div className="overflow-menu" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="overflow-menu-trigger"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.6"
          viewBox="0 0 16 16"
        >
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
      </button>
      {isOpen ? (
        <div aria-label={label} className="overflow-menu-dropdown" role="menu">
          {items.map((item) =>
            item.href ? (
              <Link
                className="overflow-menu-item"
                href={item.href}
                key={item.label}
                onClick={() => setIsOpen(false)}
                role="menuitem"
              >
                {item.label}
              </Link>
            ) : (
              <button
                className="overflow-menu-item"
                key={item.label}
                onClick={() => {
                  setIsOpen(false);
                  item.onClick?.();
                }}
                role="menuitem"
                type="button"
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
