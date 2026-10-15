"use client";

import { useEffect } from "react";
import { walletService } from "@/services/wallet-service";

export function WalletUnloadLock() {
  useEffect(() => {
    const lockWallet = () => walletService.lock();
    window.addEventListener("pagehide", lockWallet);
    return () => window.removeEventListener("pagehide", lockWallet);
  }, []);

  return null;
}
