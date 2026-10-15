"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { walletService } from "@/services/wallet-service";

export function WalletGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isUnlocked = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.isUnlocked,
    () => false,
  );

  useEffect(() => {
    if (!isUnlocked) {
      router.replace("/unlock");
    }
  }, [isUnlocked, router]);

  if (!isUnlocked) {
    return (
      <main className="page-main">
        <p className="muted-copy" role="status">
          Checking wallet session...
        </p>
      </main>
    );
  }
  return children;
}
