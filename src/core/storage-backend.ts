/**
 * The asynchronous key-value store behind `StorageService`.
 *
 * Wallet secrets live in IndexedDB rather than `localStorage` so that the
 * vaults are not reachable through the synchronous, origin-wide
 * `localStorage` namespace. The interface is deliberately tiny: values are
 * JSON strings, so the validators in `storage.ts` stay the single authority on
 * what a stored record may contain.
 */
export interface StorageBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  setMany(entries: readonly (readonly [string, string])[]): Promise<void>;
  delete(key: string): Promise<void>;
  deleteMany(keys: readonly string[]): Promise<void>;
}

const DEFAULT_DATABASE_NAME = "my-wallet";
const DEFAULT_STORE_NAME = "records";
const DATABASE_VERSION = 1;

export interface IndexedDbBackendOptions {
  /** Overridable for tests and for isolated databases. */
  readonly databaseName?: string;
  readonly storeName?: string;
}

/**
 * Creates an IndexedDB-backed store.
 *
 * The connection is opened lazily and cached, so importing this module on the
 * server (where `indexedDB` is absent) is safe; the first actual storage call
 * rejects with a clear message instead.
 */
export function createIndexedDbBackend(
  options: IndexedDbBackendOptions = {},
): StorageBackend {
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;
  let connection: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    if (connection !== null) return connection;

    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("Wallet storage is only available in a browser"));
        return;
      }

      const request = indexedDB.open(databaseName, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName);
        }
      };

      request.onsuccess = () => {
        const database = request.result;
        // Another tab requested a schema upgrade: close so it can proceed.
        database.onversionchange = () => {
          database.close();
          connection = null;
        };
        resolve(database);
      };

      request.onerror = () => {
        reject(request.error ?? new Error("Could not open wallet storage"));
      };

      // Fired when another tab holds an older connection open. Surfacing this
      // as an error is better than hanging on a promise that never settles.
      request.onblocked = () => {
        reject(
          new Error(
            "Wallet storage is blocked by another tab; close it and reload",
          ),
        );
      };
    });

    connection = pending;
    // Never cache a rejection: a later attempt (for example after the blocking
    // tab is gone) must be able to succeed.
    pending.catch(() => {
      if (connection === pending) connection = null;
    });
    return pending;
  }

  function runTransaction(
    mode: IDBTransactionMode,
    execute: (store: IDBObjectStore) => void,
  ): Promise<void> {
    return open().then(
      (database) =>
        new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(storeName, mode);
          // Resolve on completion rather than on the individual requests so a
          // write is only reported as done once it is durable.
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => {
            reject(
              transaction.error ?? new Error("Wallet storage write failed"),
            );
          };
          transaction.onabort = () => {
            reject(
              transaction.error ?? new Error("Wallet storage write was aborted"),
            );
          };
          execute(transaction.objectStore(storeName));
        }),
    );
  }

  async function get(key: string): Promise<string | null> {
    const database = await open();
    return new Promise<string | null>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => {
        // Only strings are ever written; anything else is treated as absent
        // so a foreign or corrupted record cannot masquerade as a vault.
        const value: unknown = request.result;
        resolve(typeof value === "string" ? value : null);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Wallet storage read failed"));
      };
    });
  }

  async function setMany(
    entries: readonly (readonly [string, string])[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await runTransaction("readwrite", (store) => {
      for (const [key, value] of entries) {
        store.put(value, key);
      }
    });
  }

  async function deleteMany(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await runTransaction("readwrite", (store) => {
      for (const key of keys) {
        store.delete(key);
      }
    });
  }

  return {
    get,
    setMany,
    set: (key, value) => setMany([[key, value]]),
    deleteMany,
    delete: (key) => deleteMany([key]),
  };
}
