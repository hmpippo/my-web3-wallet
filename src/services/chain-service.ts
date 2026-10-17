import { DEFAULT_CHAIN_ID, isSupportedChainId } from "@/core/chain";

export const ACTIVE_CHAIN_STORAGE_KEY = "wallet_active_chain_v1";

export interface ChainState {
  readonly activeChainId: number;
}

type ChainListener = () => void;

/**
 * The chain used while server-rendering and during hydration.
 *
 * The server has no access to `localStorage`, so it always renders the default
 * chain. Hydration must produce the same markup, so the server snapshot stays
 * pinned to the default even on the client; React then re-renders with the
 * stored preference. Returning the client value here would cause a hydration
 * mismatch.
 */
const SERVER_STATE: ChainState = Object.freeze({
  activeChainId: DEFAULT_CHAIN_ID,
});

export function getServerChainState(): ChainState {
  return SERVER_STATE;
}

/**
 * Holds the currently selected chain.
 *
 * Like `walletService`, this is a tiny external store consumed through
 * `useSyncExternalStore`. The selection is a UI preference only — it never
 * touches keys or the vault — and is persisted to `localStorage` so a reload
 * keeps the user on the same network. An unreadable or unsupported value falls
 * back to the default (Sepolia).
 */
export class ChainService {
  private state: ChainState;
  private readonly listeners = new Set<ChainListener>();
  private readonly storageKey: string;

  constructor(storageKey: string = ACTIVE_CHAIN_STORAGE_KEY) {
    this.storageKey = storageKey;
    this.state = Object.freeze({
      activeChainId: readStoredChainId(storageKey),
    });
  }

  getState = (): ChainState => this.state;

  subscribe = (listener: ChainListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get activeChainId(): number {
    return this.state.activeChainId;
  }

  setActiveChain(chainId: number): void {
    if (!isSupportedChainId(chainId)) {
      throw new RangeError(`Unsupported chain id: ${chainId}`);
    }
    if (this.state.activeChainId === chainId) return;
    writeStoredChainId(this.storageKey, chainId);
    this.state = Object.freeze({ activeChainId: chainId });
    for (const listener of this.listeners) listener();
  }
}

function readStoredChainId(storageKey: string): number {
  if (typeof window === "undefined") return DEFAULT_CHAIN_ID;
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === null) return DEFAULT_CHAIN_ID;
    const parsed: unknown = JSON.parse(serialized);
    return isSupportedChainId(parsed) ? parsed : DEFAULT_CHAIN_ID;
  } catch {
    return DEFAULT_CHAIN_ID;
  }
}

function writeStoredChainId(storageKey: string, chainId: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(chainId));
  } catch {
    // Best effort: a blocked or full localStorage must not break switching.
  }
}

export const chainService = new ChainService();
