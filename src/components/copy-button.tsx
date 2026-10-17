"use client";

import { useEffect, useRef, useState } from "react";

interface CopyButtonProps {
  /** Exact text placed on the clipboard. */
  value: string;
  /** Human-readable noun for the accessible label, e.g. "token contract address". */
  label?: string;
  className?: string;
}

export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copy() {
    try {
      await writeToClipboard(value);
    } catch {
      // Clipboard access can be denied (insecure context, permissions): leave
      // the button in its idle state rather than claiming success.
      return;
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1500);
  }

  const accessibleLabel = copied
    ? "Copied"
    : `Copy ${label ?? "address"}`;

  return (
    <button
      aria-label={accessibleLabel}
      className={className ? `copy-button ${className}` : "copy-button"}
      data-copied={copied}
      onClick={() => void copy()}
      title={accessibleLabel}
      type="button"
    >
      <svg
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
        viewBox="0 0 16 16"
      >
        {copied ? (
          <path d="M3.5 8.5l3 3 6-6.5" />
        ) : (
          <>
            <rect height="8" rx="1.5" width="8" x="5.5" y="5.5" />
            <path d="M3.5 9.5A1.5 1.5 0 0 1 2.5 8V3.5A1.5 1.5 0 0 1 4 2h4.5A1.5 1.5 0 0 1 10 3" />
          </>
        )}
      </svg>
    </button>
  );
}

async function writeToClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is not available");
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const succeeded = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!succeeded) throw new Error("Clipboard copy failed");
}
