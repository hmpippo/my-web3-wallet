import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_CHAIN_STORAGE_KEY,
  ChainService,
  getServerChainState,
} from "./chain-service";

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
  };
}

describe("active chain service", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to Sepolia without any stored preference", () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });

    expect(new ChainService().activeChainId).toBe(11155111);
  });

  it("persists the selection and notifies subscribers", () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    const service = new ChainService();
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    service.setActiveChain(8453);

    expect(service.activeChainId).toBe(8453);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      ACTIVE_CHAIN_STORAGE_KEY,
      JSON.stringify(8453),
    );
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    service.setActiveChain(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("restores a previously stored chain on construction", () => {
    const localStorage = createLocalStorageMock();
    localStorage.setItem(ACTIVE_CHAIN_STORAGE_KEY, JSON.stringify(137));
    vi.stubGlobal("window", { localStorage });

    expect(new ChainService().activeChainId).toBe(137);
  });

  it("falls back to Sepolia for an unsupported or malformed stored value", () => {
    const localStorage = createLocalStorageMock();
    localStorage.setItem(ACTIVE_CHAIN_STORAGE_KEY, JSON.stringify(999999));
    vi.stubGlobal("window", { localStorage });
    expect(new ChainService().activeChainId).toBe(11155111);

    const malformed = createLocalStorageMock();
    malformed.setItem(ACTIVE_CHAIN_STORAGE_KEY, "{not json");
    vi.stubGlobal("window", { localStorage: malformed });
    expect(new ChainService().activeChainId).toBe(11155111);
  });

  it("rejects an unsupported chain id", () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });
    const service = new ChainService();

    expect(() => service.setActiveChain(999999)).toThrow("Unsupported chain id");
  });

  it("does not notify when the same chain is selected again", () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });
    const service = new ChainService();
    const listener = vi.fn();
    service.subscribe(listener);

    service.setActiveChain(11155111);

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the hydration snapshot on the default chain regardless of storage", () => {
    const localStorage = createLocalStorageMock();
    localStorage.setItem(ACTIVE_CHAIN_STORAGE_KEY, JSON.stringify(8453));
    vi.stubGlobal("window", { localStorage });

    expect(new ChainService().activeChainId).toBe(8453);
    expect(getServerChainState()).toEqual({ activeChainId: 11155111 });
  });
});
