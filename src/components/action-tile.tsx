import Link from "next/link";
import type { ReactNode } from "react";

export type ActionIconName =
  | "send"
  | "receive"
  | "abstract"
  | "create"
  | "import"
  | "key";

interface MainActionProps {
  href: string;
  icon: ActionIconName;
  label: string;
}

interface MainActionsProps {
  children: ReactNode;
  /** Accessible name for the group, e.g. "Wallet actions". */
  ariaLabel?: string;
  /** Extra class names, e.g. `dashboard-actions`. */
  className?: string;
}

/**
 * A row of primary actions.
 *
 * Each link's box is exactly the green icon square: the label is positioned
 * outside the box and ignores pointer events, so there is no invisible
 * clickable area around the button.
 */
export function MainActions({
  ariaLabel = "Wallet actions",
  children,
  className,
}: MainActionsProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={`main-actions${className ? ` ${className}` : ""}`}
    >
      {children}
    </nav>
  );
}

export function MainAction({ href, icon, label }: MainActionProps) {
  return (
    <Link className="main-action" href={href}>
      <span className="main-action-icon">
        <ActionIcon name={icon} />
      </span>
      <span className="main-action-label">{label}</span>
    </Link>
  );
}

function ActionIcon({ name }: { name: ActionIconName }) {
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
      {ACTION_ICON_PATHS[name]}
    </svg>
  );
}

const ACTION_ICON_PATHS: Record<ActionIconName, ReactNode> = {
  send: (
    <>
      <path d="M4.5 11.5 11.5 4.5" />
      <path d="M6 4.5h5.5V10" />
    </>
  ),
  receive: (
    <>
      <path d="M11.5 4.5 4.5 11.5" />
      <path d="M10 11.5H4.5V6" />
    </>
  ),
  abstract: (
    <>
      <path d="M7 2.5l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" />
      <path d="M12 9.5l.45 1.35 1.35.45-1.35.45L12 13.1l-.45-1.35-1.35-.45 1.35-.45z" />
    </>
  ),
  create: <path d="M8 3.5v9M3.5 8h9" />,
  import: (
    <>
      <path d="M8 2.5v6.5" />
      <path d="M5.2 6.4 8 9.2l2.8-2.8" />
      <path d="M3.5 12.5h9" />
    </>
  ),
  key: (
    <>
      <circle cx="10.4" cy="5.6" r="2.4" />
      <path d="M8.6 7.4 3 13" />
      <path d="M4.4 11.6l1.6 1.6" />
      <path d="M6 10l1.6 1.6" />
    </>
  ),
};
