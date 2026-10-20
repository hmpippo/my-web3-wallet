"use client";

import { assessPassword, type PasswordStrength as Level } from "@/core/password";

const ACTIVE_BARS: Record<Level, number> = {
  weak: 1,
  fair: 2,
  strong: 3,
};

/**
 * Advisory strength estimate for a new vault password. It never blocks
 * submission; the hard requirement stays at the minimum length enforced by the
 * form and `encryptVault`.
 */
export function PasswordStrength({ password }: { password: string }) {
  if (password.length === 0) return null;

  const assessment = assessPassword(password);
  const activeBars = ACTIVE_BARS[assessment.strength];

  return (
    <div className="password-strength" data-strength={assessment.strength}>
      <div className="password-strength-track" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span data-active={index < activeBars} key={index} />
        ))}
      </div>
      <p className="password-strength-copy">
        <strong>{assessment.label}</strong> — {assessment.hint}
      </p>
    </div>
  );
}
