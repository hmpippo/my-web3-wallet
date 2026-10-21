"use client";

import { useState, type InputHTMLAttributes, type Ref } from "react";

interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Noun used in the toggle label, e.g. "password" or "private key". */
  revealLabel?: string;
  /** Lets a dialog move focus into the field when it opens. */
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Password-style input with a built-in show/hide toggle.
 *
 * `type` is owned by this component so every password box in the app behaves
 * the same way. Native validation (`required`, `minLength`, `autoComplete`)
 * still applies in both the masked and revealed state.
 */
export function PasswordInput({
  revealLabel = "password",
  inputRef,
  ...inputProps
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const action = visible ? "Hide" : "Show";

  return (
    <span className="password-input-wrapper">
      <input {...inputProps} ref={inputRef} type={visible ? "text" : "password"} />
      <button
        aria-label={`${action} ${revealLabel}`}
        aria-pressed={visible}
        className="password-visibility"
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        <EyeIcon crossed={visible} />
      </button>
    </span>
  );
}

/** Eye icon that draws a slash while the value is revealed. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {crossed ? (
        <path
          d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A11.5 11.5 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1.1-1.2 2.2-2.2 3.2M6.2 6.2C3.9 7.7 2.8 10 2.5 12c1 2.5 4.5 7 9.5 7 1.1 0 2.1-.2 3-.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <path
            d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
