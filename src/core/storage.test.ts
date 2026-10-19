import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_METADATA_STORAGE_KEY,
  BIOMETRIC_VAULT_STORAGE_KEY,
  IMPORTED_ACCOUNT_PATH,
  storageService,
  VAULT_STORAGE_KEY,
  WALLET_REGISTRY_STORAGE_KEY,
  walletAccountMetadataKey,
  walletBiometricVaultKey,
  walletVaultKey,
  type WalletAccountMetadata,
  type WalletRegistry,
} from "./storage";
import type { EncryptedVault } from "./crypto";
import type { BiometricVault } from "./biometric-vault";

const WALLET_ID = "wallet-test-1";

const testVault: EncryptedVault = {
  version: 1,
  salt: "c2FsdA==",
  iv: "aXY=",
  ciphertext: "Y2lwaGVydGV4dA==",
};
const testBiometricVault: BiometricVault = {
  version: 1,
  credentialId: "Y3JlZGVudGlhbA",
  rpId: "localhost",
  prfSalt: "c2FsdA==",
  kdfSalt: "a2Rmc2FsdA==",
  iv: "aXY=",
  ciphertext: "Y2lwaGVydGV4dA==",
  createdAt: 1_700_000_000_000,
};
const testAccountMetadata: WalletAccountMetadata = {
  version: 1,
  accounts: [
    {
      path: "m/44'/60'/0'/0/0",
      name: "Account 1",
      hidden: false,
      tokens: [],
      nfts: [],
    },
    {
      path: "m/44'/60'/0'/0/2",
      name: "Savings",
      hidden: false,
      tokens: [
        {
          chainId: 11155111,
          address: "0x0000000000000000000000000000000000000001",
          name: "Test Token",
          symbol: "TST",
          decimals: 6,
          hidden: false,
        },
      ],
      nfts: [
        {
          chainId: 11155111,
          address: "0x0000000000000000000000000000000000000003",
          tokenId: "42",
          standard: "ERC-721",
          name: "Test NFT",
          description: "A test item",
          imageUrl: "https://example.com/image.png",
        },
      ],
    },
  ],
  selectedPath: "m/44'/60'/0'/0/2",
};
const testRegistry: WalletRegistry = {
  version: 1,
  wallets: [
    { id: WALLET_ID, name: "Spending", createdAt: 1_700_000_000_000 },
  ],
  selectedId: WALLET_ID,
};

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
  };
}

describe("vault storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves and loads the encrypted vault under the wallet-scoped key", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveVault(WALLET_ID, testVault);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      walletVaultKey(WALLET_ID),
      JSON.stringify(testVault),
    );
    await expect(storageService.loadVault(WALLET_ID)).resolves.toEqual(
      testVault,
    );
    await expect(storageService.hasVault(WALLET_ID)).resolves.toBe(true);
  });

  it("keeps wallets isolated by id", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });

    await storageService.saveVault(WALLET_ID, testVault);

    await expect(storageService.loadVault("other-wallet")).resolves.toBeNull();
    await expect(storageService.hasVault("other-wallet")).resolves.toBe(false);
  });

  it("returns null when no vault has been saved", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });

    await expect(storageService.loadVault(WALLET_ID)).resolves.toBeNull();
    await expect(storageService.hasVault(WALLET_ID)).resolves.toBe(false);
  });

  it("clears the stored vault, metadata, and biometric record for one wallet", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveVault(WALLET_ID, testVault);
    await storageService.saveAccountMetadata(WALLET_ID, testAccountMetadata);
    await storageService.saveBiometricVault(WALLET_ID, testBiometricVault);
    await storageService.clearVault(WALLET_ID);

    expect(localStorage.removeItem).toHaveBeenCalledWith(
      walletVaultKey(WALLET_ID),
    );
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      walletAccountMetadataKey(WALLET_ID),
    );
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      walletBiometricVaultKey(WALLET_ID),
    );
    await expect(storageService.loadVault(WALLET_ID)).resolves.toBeNull();
    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).resolves.toBeNull();
    await expect(
      storageService.loadBiometricVault(WALLET_ID),
    ).resolves.toBeNull();
  });

  it("saves and loads validated public account metadata", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveAccountMetadata(WALLET_ID, testAccountMetadata);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify(testAccountMetadata),
    );
    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).resolves.toEqual(testAccountMetadata);
  });

  it("returns null when account metadata has not been created yet", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });

    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).resolves.toBeNull();
  });

  it("rejects malformed or unsafe account metadata", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(walletAccountMetadataKey(WALLET_ID), "{");
    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).rejects.toThrow("not valid JSON");

    localStorage.setItem(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify({
        ...testAccountMetadata,
        accounts: [
          ...testAccountMetadata.accounts,
          { path: "m/44'/60'/0'/0/2", name: "Duplicate", hidden: false },
        ],
      }),
    );
    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).rejects.toThrow("invalid or duplicate accounts");

    localStorage.setItem(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify({
        ...testAccountMetadata,
        accounts: testAccountMetadata.accounts.map((account) => ({
          ...account,
          hidden: true,
        })),
      }),
    );
    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).rejects.toThrow("invalid or duplicate accounts");
  });

  it("stores an imported-key wallet as a single account without a derivation path", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    const importedMetadata: WalletAccountMetadata = {
      version: 1,
      accounts: [
        {
          path: IMPORTED_ACCOUNT_PATH,
          name: "Account 1",
          hidden: false,
          tokens: [],
          nfts: [],
        },
      ],
      selectedPath: IMPORTED_ACCOUNT_PATH,
    };

    await storageService.saveAccountMetadata(WALLET_ID, importedMetadata);

    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).resolves.toEqual(importedMetadata);
  });

  it("rejects mixing an imported account with HD accounts", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify({
        version: 1,
        accounts: [
          { path: "m/44'/60'/0'/0/0", name: "Account 1", hidden: false },
          { path: IMPORTED_ACCOUNT_PATH, name: "Imported", hidden: false },
        ],
        selectedPath: "m/44'/60'/0'/0/0",
      }),
    );

    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).rejects.toThrow("invalid or duplicate accounts");
  });

  it("rejects duplicate or invalid token metadata", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    const first = testAccountMetadata.accounts[1]!;
    const token = first.tokens![0]!;

    await expect(
      storageService.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, tokens: [token, token] },
        ],
      }),
    ).rejects.toThrow("duplicate tokens");

    await expect(
      storageService.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          {
            ...first,
            tokens: [{ ...token, decimals: 256 }],
          },
        ],
      }),
    ).rejects.toThrow("invalid token");
  });

  it("rejects duplicate or invalid NFT metadata", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });
    const first = testAccountMetadata.accounts[1]!;
    const nft = first.nfts![0]!;
    await expect(
      storageService.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, nfts: [nft, nft] },
        ],
      }),
    ).rejects.toThrow("duplicate NFTs");

    await expect(
      storageService.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, nfts: [{ ...nft, imageUrl: "http://127.0.0.1/image" }] },
        ],
      }),
    ).rejects.toThrow("invalid NFT");

    await expect(
      storageService.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, nfts: [{ ...nft, tokenId: "1e4" }] },
        ],
      }),
    ).rejects.toThrow("invalid NFT");
  });

  it("stores inline data: image links for on-chain NFTs", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    const first = testAccountMetadata.accounts[1]!;
    const nft = first.nfts![0]!;
    const imageUrl = `data:image/svg+xml;base64,${Buffer.from(
      "<svg></svg>",
    ).toString("base64")}`;

    await storageService.saveAccountMetadata(WALLET_ID, {
      ...testAccountMetadata,
      accounts: [
        testAccountMetadata.accounts[0]!,
        { ...first, nfts: [{ ...nft, imageUrl }] },
      ],
    });

    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).resolves.toMatchObject({
      accounts: [{ nfts: [] }, { nfts: [{ imageUrl }] }],
    });
  });

  it("loads legacy account records without token or NFT lists as empty lists", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    localStorage.setItem(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify({
        version: 1,
        accounts: [
          { path: "m/44'/60'/0'/0/0", name: "Account 1", hidden: false },
        ],
        selectedPath: "m/44'/60'/0'/0/0",
      }),
    );

    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).resolves.toMatchObject({
      accounts: [{ tokens: [], nfts: [] }],
    });
  });

  it("keeps the same token and NFT address on different chains", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    const first = testAccountMetadata.accounts[1]!;
    const token = first.tokens![0]!;
    const nft = first.nfts![0]!;

    await storageService.saveAccountMetadata(WALLET_ID, {
      ...testAccountMetadata,
      accounts: [
        testAccountMetadata.accounts[0]!,
        {
          ...first,
          tokens: [token, { ...token, chainId: 1 }],
          nfts: [nft, { ...nft, chainId: 1 }],
        },
      ],
    });

    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).resolves.toMatchObject({
      accounts: [
        { tokens: [], nfts: [] },
        {
          tokens: [{ chainId: 11155111 }, { chainId: 1 }],
          nfts: [{ chainId: 11155111 }, { chainId: 1 }],
        },
      ],
    });
  });

  it("defaults legacy assets without a chain to Sepolia", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    localStorage.setItem(
      walletAccountMetadataKey(WALLET_ID),
      JSON.stringify({
        version: 1,
        accounts: [
          {
            path: "m/44'/60'/0'/0/0",
            name: "Account 1",
            hidden: false,
            tokens: [
              {
                address: "0x0000000000000000000000000000000000000001",
                name: "Test Token",
                symbol: "TST",
                decimals: 6,
                hidden: false,
              },
            ],
            nfts: [],
          },
        ],
        selectedPath: "m/44'/60'/0'/0/0",
      }),
    );

    await expect(
      storageService.loadAccountMetadata(WALLET_ID),
    ).resolves.toMatchObject({
      accounts: [{ tokens: [{ chainId: 11155111 }] }],
    });
  });

  it("rejects assets that reference an unsupported chain", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });
    const first = testAccountMetadata.accounts[1]!;
    const token = first.tokens![0]!;

    await expect(
      storageService.saveAccountMetadata(WALLET_ID, {
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, tokens: [{ ...token, chainId: 999999 }] },
        ],
      }),
    ).rejects.toThrow("unsupported chain");
  });

  it("surfaces invalid stored JSON and invalid vault shapes", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(walletVaultKey(WALLET_ID), "{");
    await expect(storageService.loadVault(WALLET_ID)).rejects.toThrow(
      "Stored vault is not valid JSON",
    );

    localStorage.setItem(
      walletVaultKey(WALLET_ID),
      JSON.stringify({ version: 1 }),
    );
    await expect(storageService.loadVault(WALLET_ID)).rejects.toThrow(
      "invalid structure",
    );
  });

  it("fails explicitly outside a browser", async () => {
    vi.stubGlobal("window", undefined);

    await expect(storageService.loadVault(WALLET_ID)).rejects.toThrow(
      "only available in a browser",
    );
    await expect(storageService.loadRegistry()).rejects.toThrow(
      "only available in a browser",
    );
  });
});

describe("wallet registry storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves and loads the registry under a single key", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveRegistry(testRegistry);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      WALLET_REGISTRY_STORAGE_KEY,
      JSON.stringify(testRegistry),
    );
    await expect(storageService.loadRegistry()).resolves.toEqual(testRegistry);
  });

  it("returns null when there is no registry and no legacy wallet", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });

    await expect(storageService.loadRegistry()).resolves.toBeNull();
  });

  it("round-trips a wallet's kind", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });
    const registry: WalletRegistry = {
      version: 1,
      wallets: [
        {
          id: WALLET_ID,
          name: "Imported key 1",
          createdAt: 1_700_000_000_000,
          kind: "privateKey",
        },
      ],
      selectedId: WALLET_ID,
    };

    await storageService.saveRegistry(registry);

    await expect(storageService.loadRegistry()).resolves.toEqual(registry);
  });

  it("rejects an unknown kind", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(
      WALLET_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        wallets: [
          {
            id: WALLET_ID,
            name: "Wallet 1",
            createdAt: 1,
            kind: "seedless",
          },
        ],
        selectedId: WALLET_ID,
      }),
    );
    await expect(storageService.loadRegistry()).rejects.toThrow(
      "invalid wallet",
    );
  });

  it("rejects a malformed or duplicate registry", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(WALLET_REGISTRY_STORAGE_KEY, "{");
    await expect(storageService.loadRegistry()).rejects.toThrow(
      "not valid JSON",
    );

    localStorage.setItem(
      WALLET_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        wallets: [
          { id: WALLET_ID, name: "A", createdAt: 1 },
          { id: WALLET_ID, name: "B", createdAt: 2 },
        ],
        selectedId: WALLET_ID,
      }),
    );
    await expect(storageService.loadRegistry()).rejects.toThrow(
      "duplicate wallets",
    );
  });

  it("migrates a legacy single-wallet install into the registry", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(testVault));
    localStorage.setItem(
      ACCOUNT_METADATA_STORAGE_KEY,
      JSON.stringify(testAccountMetadata),
    );
    localStorage.setItem(
      BIOMETRIC_VAULT_STORAGE_KEY,
      JSON.stringify(testBiometricVault),
    );

    const registry = await storageService.loadRegistry();

    expect(registry?.wallets).toHaveLength(1);
    expect(registry?.wallets[0]?.name).toBe("Wallet 1");
    const migratedId = registry?.wallets[0]?.id;
    expect(registry?.selectedId).toBe(migratedId);
    if (!migratedId) throw new Error("expected a migrated wallet id");

    // The records now live under wallet-scoped keys...
    await expect(storageService.loadVault(migratedId)).resolves.toEqual(
      testVault,
    );
    await expect(
      storageService.loadAccountMetadata(migratedId),
    ).resolves.toEqual(testAccountMetadata);
    await expect(
      storageService.loadBiometricVault(migratedId),
    ).resolves.toEqual(testBiometricVault);
    // ...and the legacy keys are gone.
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(ACCOUNT_METADATA_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(BIOMETRIC_VAULT_STORAGE_KEY)).toBeNull();

    // Migration is idempotent: the persisted registry is returned on reload.
    await expect(storageService.loadRegistry()).resolves.toEqual(registry);
  });
});

describe("biometric vault storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves and loads the biometric vault under the wallet-scoped key", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveBiometricVault(WALLET_ID, testBiometricVault);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      walletBiometricVaultKey(WALLET_ID),
      JSON.stringify(testBiometricVault),
    );
    await expect(
      storageService.loadBiometricVault(WALLET_ID),
    ).resolves.toEqual(testBiometricVault);
  });

  it("returns null when no biometric vault has been saved", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });

    await expect(
      storageService.loadBiometricVault(WALLET_ID),
    ).resolves.toBeNull();
  });

  it("rejects malformed biometric vault records", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(walletBiometricVaultKey(WALLET_ID), "{");
    await expect(
      storageService.loadBiometricVault(WALLET_ID),
    ).rejects.toThrow("not valid JSON");

    localStorage.setItem(
      walletBiometricVaultKey(WALLET_ID),
      JSON.stringify({ version: 1 }),
    );
    await expect(
      storageService.loadBiometricVault(WALLET_ID),
    ).rejects.toThrow("invalid structure");
  });

  it("clears only the biometric vault for one wallet", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveBiometricVault(WALLET_ID, testBiometricVault);
    await storageService.clearBiometricVault(WALLET_ID);

    expect(localStorage.removeItem).toHaveBeenCalledWith(
      walletBiometricVaultKey(WALLET_ID),
    );
    await expect(
      storageService.loadBiometricVault(WALLET_ID),
    ).resolves.toBeNull();
  });
});
