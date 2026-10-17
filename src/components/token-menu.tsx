"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface TokenMenuProps {
  /** Re-reads native and token balances for the list. */
  onRefresh: () => void;
}

/** Overflow menu for the Tokens list: refresh, or jump to token management. */
export function TokenMenu({ onRefresh }: TokenMenuProps) {
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
    <div className="token-menu" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Token list options"
        className="token-menu-trigger"
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
        <div className="token-menu-dropdown" role="menu">
          <button
            className="token-menu-item"
            onClick={() => {
              setIsOpen(false);
              onRefresh();
            }}
            role="menuitem"
            type="button"
          >
            Refresh list
          </button>
          <Link
            className="token-menu-item"
            href="/tokens"
            onClick={() => setIsOpen(false)}
            role="menuitem"
          >
            Manage tokens
          </Link>
        </div>
      ) : null}
    </div>
  );
}
