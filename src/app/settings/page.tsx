import { SiteHeader } from "@/components/site-header";
import { BiometricUnlockSettings } from "@/components/biometric-unlock-settings";
import { WalletGuard } from "@/components/wallet-guard";

export default function SettingsPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <BiometricUnlockSettings />
      </WalletGuard>
    </>
  );
}
