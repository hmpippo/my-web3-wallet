/**
 * Shortens an address for display while keeping both ends recognizable, e.g.
 * `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` → `0xf39F…2266`.
 *
 * Values too short to shorten are returned unchanged.
 */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
