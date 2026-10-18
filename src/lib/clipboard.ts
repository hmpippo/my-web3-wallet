/**
 * Clipboard helpers shared by the copy button and the private-key screen.
 *
 * Writes prefer the async Clipboard API and fall back to a hidden, readonly
 * textarea plus `execCommand` so copying still works in older or locked-down
 * browsers and in insecure contexts.
 */
export async function writeToClipboard(value: string): Promise<void> {
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

/**
 * Overwrites the clipboard with an empty string so a previously copied secret
 * does not linger. Best-effort: it rejects only when the clipboard is entirely
 * unavailable.
 */
export async function clearClipboard(): Promise<void> {
  await writeToClipboard("");
}
