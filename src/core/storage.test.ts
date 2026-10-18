import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_METADATA_STORAGE_KEY,
  BIOMETRIC_VAULT_STORAGE_KEY,
  storageService,
  VAULT_STORAGE_KEY,
  type WalletAccountMetadata,
} from "./storage";
import type { EncryptedVault } from "./crypto";
import type { BiometricVault } from "./biometric-vault";

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

  it("saves and loads only the encrypted vault under the fixed key", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveVault(testVault);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      VAULT_STORAGE_KEY,
      JSON.stringify(testVault),
    );
    await expect(storageService.loadVault()).resolves.toEqual(testVault);
    await expect(storageService.hasVault()).resolves.toBe(true);
  });

  it("returns null when no vault has been saved", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });

    await expect(storageService.loadVault()).resolves.toBeNull();
    await expect(storageService.hasVault()).resolves.toBe(false);
  });

  it("clears the stored vault", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveVault(testVault);
    await storageService.saveAccountMetadata(testAccountMetadata);
    await storageService.clearVault();

    expect(localStorage.removeItem).toHaveBeenCalledWith(VAULT_STORAGE_KEY);
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      ACCOUNT_METADATA_STORAGE_KEY,
    );
    await expect(storageService.loadVault()).resolves.toBeNull();
    await expect(storageService.loadAccountMetadata()).resolves.toBeNull();
  });

  it("saves and loads validated public account metadata", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveAccountMetadata(testAccountMetadata);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      ACCOUNT_METADATA_STORAGE_KEY,
      JSON.stringify(testAccountMetadata),
    );
    await expect(storageService.loadAccountMetadata()).resolves.toEqual(
      testAccountMetadata,
    );
  });

  it("returns null when account metadata has not been created yet", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });

    await expect(storageService.loadAccountMetadata()).resolves.toBeNull();
  });

  it("rejects malformed or unsafe account metadata", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(ACCOUNT_METADATA_STORAGE_KEY, "{");
    await expect(storageService.loadAccountMetadata()).rejects.toThrow(
      "not valid JSON",
    );

    localStorage.setItem(
      ACCOUNT_METADATA_STORAGE_KEY,
      JSON.stringify({
        ...testAccountMetadata,
        accounts: [
          ...testAccountMetadata.accounts,
          { path: "m/44'/60'/0'/0/2", name: "Duplicate", hidden: false },
        ],
      }),
    );
    await expect(storageService.loadAccountMetadata()).rejects.toThrow(
      "invalid or duplicate accounts",
    );

    localStorage.setItem(
      ACCOUNT_METADATA_STORAGE_KEY,
      JSON.stringify({
        ...testAccountMetadata,
        accounts: testAccountMetadata.accounts.map((account) => ({
          ...account,
          hidden: true,
        })),
      }),
    );
    await expect(storageService.loadAccountMetadata()).rejects.toThrow(
      "invalid or duplicate accounts",
    );
  });

  it("rejects duplicate or invalid token metadata", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    const first = testAccountMetadata.accounts[1]!;
    const token = first.tokens![0]!;

    await expect(
      storageService.saveAccountMetadata({
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, tokens: [token, token] },
        ],
      }),
    ).rejects.toThrow("duplicate tokens");

    await expect(
      storageService.saveAccountMetadata({
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
      storageService.saveAccountMetadata({
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, nfts: [nft, nft] },
        ],
      }),
    ).rejects.toThrow("duplicate NFTs");

    await expect(
      storageService.saveAccountMetadata({
        ...testAccountMetadata,
        accounts: [
          testAccountMetadata.accounts[0]!,
          { ...first, nfts: [{ ...nft, imageUrl: "http://127.0.0.1/image" }] },
        ],
      }),
    ).rejects.toThrow("invalid NFT");

    await expect(
      storageService.saveAccountMetadata({
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

    await storageService.saveAccountMetadata({
      ...testAccountMetadata,
      accounts: [
        testAccountMetadata.accounts[0]!,
        { ...first, nfts: [{ ...nft, imageUrl }] },
      ],
    });

    await expect(storageService.loadAccountMetadata()).resolves.toMatchObject({
      accounts: [{ nfts: [] }, { nfts: [{ imageUrl }] }],
    });
  });

  it("loads legacy account records without token or NFT lists as empty lists", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    localStorage.setItem(
      ACCOUNT_METADATA_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accounts: [
          { path: "m/44'/60'/0'/0/0", name: "Account 1", hidden: false },
        ],
        selectedPath: "m/44'/60'/0'/0/0",
      }),
    );

    await expect(storageService.loadAccountMetadata()).resolves.toMatchObject({
      accounts: [{ tokens: [], nfts: [] }],
    });
  });

  it("keeps the same token and NFT address on different chains", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });
    const first = testAccountMetadata.accounts[1]!;
    const token = first.tokens![0]!;
    const nft = first.nfts![0]!;

    await storageService.saveAccountMetadata({
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

    await expect(storageService.loadAccountMetadata()).resolves.toMatchObject({
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
      ACCOUNT_METADATA_STORAGE_KEY,
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

    await expect(storageService.loadAccountMetadata()).resolves.toMatchObject({
      accounts: [{ tokens: [{ chainId: 11155111 }] }],
    });
  });

  it("rejects assets that reference an unsupported chain", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });
    const first = testAccountMetadata.accounts[1]!;
    const token = first.tokens![0]!;

    await expect(
      storageService.saveAccountMetadata({
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

    localStorage.setItem(VAULT_STORAGE_KEY, "{");
    await expect(storageService.loadVault()).rejects.toThrow(
      "Stored vault is not valid JSON",
    );

    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify({ version: 1 }));
    await expect(storageService.loadVault()).rejects.toThrow(
      "invalid structure",
    );
  });

  it("fails explicitly outside a browser", async () => {
    vi.stubGlobal("window", undefined);

    await expect(storageService.loadVault()).rejects.toThrow(
      "only available in a browser",
    );
  });
});

describe("biometric vault storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves and loads the biometric vault under the fixed key", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveBiometricVault(testBiometricVault);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      BIOMETRIC_VAULT_STORAGE_KEY,
      JSON.stringify(testBiometricVault),
    );
    await expect(storageService.loadBiometricVault()).resolves.toEqual(
      testBiometricVault,
    );
  });

  it("returns null when no biometric vault has been saved", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });

    await expect(storageService.loadBiometricVault()).resolves.toBeNull();
  });

  it("rejects malformed biometric vault records", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(BIOMETRIC_VAULT_STORAGE_KEY, "{");
    await expect(storageService.loadBiometricVault()).rejects.toThrow(
      "not valid JSON",
    );

    localStorage.setItem(
      BIOMETRIC_VAULT_STORAGE_KEY,
      JSON.stringify({ version: 1 }),
    );
    await expect(storageService.loadBiometricVault()).rejects.toThrow(
      "invalid structure",
    );
  });

  it("removes the biometric vault together with the wallet", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveBiometricVault(testBiometricVault);
    await storageService.clearVault();

    expect(localStorage.removeItem).toHaveBeenCalledWith(
      BIOMETRIC_VAULT_STORAGE_KEY,
    );
    await expect(storageService.loadBiometricVault()).resolves.toBeNull();
  });

  it("clears only the biometric vault", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveBiometricVault(testBiometricVault);
    await storageService.clearBiometricVault();

    expect(localStorage.removeItem).toHaveBeenCalledWith(
      BIOMETRIC_VAULT_STORAGE_KEY,
    );
    await expect(storageService.loadBiometricVault()).resolves.toBeNull();
  });
});
