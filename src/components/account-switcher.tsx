"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Address } from "viem";
import { truncateAddress } from "@/lib/address";

export interface AccountSwitcherAccount {
  index: number;
  name: string;
  address: Address;
}

interface AccountSwitcherProps {
  accounts: readonly AccountSwitcherAccount[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  disabled?: boolean;
}

/**
 * Account picker used on the wallet overview.
 *
 * The trigger shows the account name and a shortened address, matching the
 * pattern popular wallets use on mobile. Tapping it opens a small listbox with
 * every account; the current one is marked and focused first.
 *
 * Kept as its own component so the dashboard's account-switching logic (which
 * persists the selection and can fail) stays in the page.
 */
export function AccountSwitcher({
  accounts,
  selectedIndex,
  onSelect,
  disabled = false,
}: AccountSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selected =
    accounts.find((account) => account.index === selectedIndex) ?? accounts[0];
  const selectedOptionIndex = Math.max(
    0,
    accounts.findIndex((account) => account.index === selected?.index),
  );
  const canSwitch = accounts.length > 1 && !disabled;

  // Keep the menu from staying open when this account becomes the only one
  // (for example after hiding the others from Manage accounts).
  if (!canSwitch && isOpen) setIsOpen(false);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  // Put keyboard focus straight on the current account when the list opens.
  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[selectedOptionIndex]?.focus({ preventScroll: true });
  }, [isOpen, selectedOptionIndex]);

  // Flip the menu above the trigger when there is not enough room below, so a
  // short phone viewport never clips the last account.
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

  if (!selected) return null;

  function closeMenu(returnFocus = false) {
    setIsOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = optionRefs.current.findIndex(
      (option) => option === document.activeElement,
    );

    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex =
          currentIndex < 0 ? 0 : (currentIndex + 1) % accounts.length;
        break;
      case "ArrowUp":
        nextIndex =
          currentIndex < 0
            ? accounts.length - 1
            : (currentIndex - 1 + accounts.length) % accounts.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = accounts.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        return;
      case "Tab":
        // Let focus leave naturally; the menu should never trap the user.
        setIsOpen(false);
        return;
      default:
        return;
    }

    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="account-picker" ref={containerRef}>
      <button
        ref={triggerRef}
        aria-disabled={canSwitch ? undefined : true}
        aria-expanded={canSwitch ? isOpen : undefined}
        aria-haspopup={canSwitch ? "listbox" : undefined}
        aria-label={`Account: ${selected.name}, ${selected.address}${
          canSwitch ? ". Switch account" : ""
        }`}
        className="account-picker-trigger"
        disabled={disabled}
        onClick={() => {
          if (!canSwitch) return;
          setIsOpen((open) => !open);
        }}
        type="button"
      >
        <span className="account-picker-identity">
          <strong className="account-picker-name">{selected.name}</strong>
          <code className="account-picker-address" title={selected.address}>
            {truncateAddress(selected.address)}
          </code>
        </span>
        {canSwitch ? <ChevronIcon /> : null}
      </button>

      {isOpen ? (
        <div
          aria-label="Select account"
          className="account-picker-menu"
          data-placement={placement}
          onKeyDown={handleMenuKeyDown}
          ref={menuRef}
          role="listbox"
        >
          {accounts.map((account, index) => {
            const isSelected = account.index === selected.index;
            return (
              <button
                aria-selected={isSelected}
                className="account-picker-option"
                key={account.index}
                onClick={() => {
                  closeMenu(true);
                  if (!isSelected) onSelect(account.index);
                }}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <span className="account-picker-option-text">
                  <strong>{account.name}</strong>
                  <code>{truncateAddress(account.address)}</code>
                </span>
                {isSelected ? <CheckIcon /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      className="account-picker-chevron"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
    >
      <path d="M4 6.5 8 10.5l4-4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="account-picker-check"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 16 16"
    >
      <path d="M3.5 8.5l3 3 6-6.5" />
    </svg>
  );
}
