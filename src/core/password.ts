/**
 * Password quality rules.
 *
 * The hard minimum stays at 8 characters: raising it would reject passwords
 * that existing vaults were created with, and the UI only nudges with the
 * strength estimate below. The estimate is advisory — it never blocks a
 * password that passes `passwordPolicyError`.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1024;

export type PasswordStrength = "weak" | "fair" | "strong";

export interface PasswordAssessment {
  readonly strength: PasswordStrength;
  readonly label: string;
  readonly hint: string;
}

/**
 * Normalized (lowercase, alphanumerics only) passwords that are common enough
 * to be tried first by any offline guessing rig. Short by design: this is a
 * nudge, not a breached-password database.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "password12345",
  "password123456",
  "passw0rd",
  "p4ssw0rd",
  "qwerty",
  "qwertyuiop",
  "qwerty123",
  "12345678",
  "123456789",
  "1234567890",
  "123456789012",
  "11111111",
  "00000000",
  "abc12345",
  "abcdefgh",
  "abcdefghij",
  "iloveyou",
  "letmein",
  "letmein123",
  "welcome",
  "welcome1",
  "admin",
  "admin123",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "sunshine",
  "princess",
  "superman",
  "trustno1",
  "master",
  "shadow",
  "hunter2",
  "changeme",
  "secret",
  "mypassword",
  "wallet",
  "wallet123",
  "bitcoin",
  "ethereum",
  "metamask",
  "crypto",
  "blockchain",
  "satoshi",
  "recovery",
  "mnemonic",
  "seedphrase",
  "testtest",
]);

const SEQUENCES = [
  "0123456789",
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
];

export function passwordPolicyError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Length, character variety, and word count, with a few well-known weak
 * patterns called out explicitly. Tuned so that an 8-character multi-class
 * password is "fair" rather than "weak", while a long passphrase is "strong".
 */
export function assessPassword(password: string): PasswordAssessment {
  if (password.length === 0) {
    return {
      strength: "weak",
      label: "Weak",
      hint: "Choose a password you do not use anywhere else.",
    };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      strength: "weak",
      label: "Too short",
      hint: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (isCommonPattern(password)) {
    return {
      strength: "weak",
      label: "Weak",
      hint: "This is a commonly guessed pattern. Pick something unique.",
    };
  }

  const classes = characterClassCount(password);
  const words = wordCount(password);

  if (
    password.length >= 16 ||
    (password.length >= 12 && (classes >= 3 || words >= 4))
  ) {
    return {
      strength: "strong",
      label: "Strong",
      hint: "Good. A long, unique passphrase is hardest to guess offline.",
    };
  }

  if (password.length >= 12 || classes >= 3) {
    return {
      strength: "fair",
      label: "Fair",
      hint: "Add another word or two to make offline guessing harder.",
    };
  }

  return {
    strength: "weak",
    label: "Weak",
    hint: "Length matters most. Try a multi-word passphrase.",
  };
}

function normalize(password: string): string {
  return password.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isCommonPattern(password: string): boolean {
  const normalized = normalize(password);
  if (COMMON_PASSWORDS.has(normalized)) return true;
  if (password.length > 0 && /^(.)\1+$/.test(password)) return true;
  if (normalized.length < 6) return false;

  return SEQUENCES.some(
    (sequence) =>
      sequence.includes(normalized) ||
      [...sequence].reverse().join("").includes(normalized),
  );
}

function characterClassCount(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/\d/.test(password)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(password)) classes += 1;
  return classes;
}

function wordCount(password: string): number {
  return password
    .split(/[\s\-_.]+/)
    .filter((word) => /[a-zA-Z]{2,}/.test(word)).length;
}
