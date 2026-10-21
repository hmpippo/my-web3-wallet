"use client";

import Link from "next/link";
import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type OverflowMenuIcon =
  | "unlock"
  | "rename"
  | "delete"
  | "show"
  | "hide"
  | "detail"
  | "refresh"
  | "manage"
  | "import";

export interface OverflowMenuItem {
  label: string;
  /** Leading icon shown before the label. */
  icon?: OverflowMenuIcon;
  /** `danger` tints destructive actions red. */
  tone?: "default" | "danger";
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
  const [placement, setPlacement] = useState<"below" | "above">("below");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Flip the menu above the trigger when the viewport is too short below it,
  // so a trigger near the bottom of the page never opens its list off-screen.
  useLayoutEffect(() => {
    if (!isOpen) return;

    function placeMenu() {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const spaceBelow =
        window.innerHeight - trigger.getBoundingClientRect().bottom;
      setPlacement(spaceBelow < menu.offsetHeight + 12 ? "above" : "below");
    }

    placeMenu();
    window.addEventListener("resize", placeMenu);
    return () => window.removeEventListener("resize", placeMenu);
  }, [isOpen]);

  function toggle() {
    if (!isOpen) setPlacement("below");
    setIsOpen(!isOpen);
  }

  return (
    <div className="overflow-menu" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="overflow-menu-trigger"
        onClick={toggle}
        ref={triggerRef}
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
        <div
          aria-label={label}
          className={`overflow-menu-dropdown${
            placement === "above" ? " overflow-menu-dropdown-above" : ""
          }`}
          ref={menuRef}
          role="menu"
        >
          {items.map((item) => {
            const className = `overflow-menu-item${
              item.tone === "danger" ? " overflow-menu-item-danger" : ""
            }`;
            const content = (
              <>
                <span className="overflow-menu-icon">
                  {item.icon ? <MenuIcon name={item.icon} /> : null}
                </span>
                {item.label}
              </>
            );

            return item.href ? (
              <Link
                className={className}
                href={item.href}
                key={item.label}
                onClick={() => setIsOpen(false)}
                role="menuitem"
              >
                {content}
              </Link>
            ) : (
              <button
                className={className}
                key={item.label}
                onClick={() => {
                  setIsOpen(false);
                  item.onClick?.();
                }}
                role="menuitem"
                type="button"
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Small 16×16 stroke icons for menu items. They inherit `currentColor`, so a
 * danger item's icon turns red with its label.
 */
function MenuIcon({ name }: { name: OverflowMenuIcon }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 16 16"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

const ICON_PATHS: Record<OverflowMenuIcon, ReactNode> = {
  unlock: (
    <>
      <rect height="6" rx="1.2" width="9" x="3.5" y="7" />
      <path d="M5.6 7V5.5a2.9 2.9 0 0 1 5.5-1.4" />
    </>
  ),
  rename: (
    <>
      <path d="M3 13l.7-2.8 6.6-6.6 2.1 2.1-6.6 6.6L3 13z" />
      <path d="M9.4 4.5l2.1 2.1" />
    </>
  ),
  delete: (
    <>
      <path d="M3 4.8h10" />
      <path d="M6.4 4.8V3.4h3.2v1.4" />
      <path d="M4.6 4.8l.6 8.2h5.6l.6-8.2" />
      <path d="M6.7 7.2v3.4M9.3 7.2v3.4" />
    </>
  ),
  show: (
    <>
      <path d="M1.5 8S3.8 3.8 8 3.8 14.5 8 14.5 8 12.2 12.2 8 12.2 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  hide: (
    <>
      <path d="M1.5 8S3.8 3.8 8 3.8 14.5 8 14.5 8 12.2 12.2 8 12.2 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
      <path d="M2.5 2.5l11 11" />
    </>
  ),
  detail: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.4v3.2" />
      <path d="M8 5.3h.01" />
    </>
  ),
  refresh: (
    <>
      <path d="M15 2.7v4h-4" />
      <path d="M1 13.3v-4h4" />
      <path d="M2.3 6a6 6 0 0 1 9.9-2.2L15 6.7" />
      <path d="M1 9.3l3.1 2.9A6 6 0 0 0 13.7 10" />
    </>
  ),
  manage: (
    <>
      <path d="M3 5.5h10M3 10.5h10" />
      <circle cx="6.4" cy="5.5" r="1.7" />
      <circle cx="9.6" cy="10.5" r="1.7" />
    </>
  ),
  import: (
    <>
      <path d="M8 2.5v7" />
      <path d="M5 6.8l3 3 3-3" />
      <path d="M3.5 12.5h9" />
    </>
  ),
};
