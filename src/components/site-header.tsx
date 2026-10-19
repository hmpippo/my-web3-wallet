import Link from "next/link";
import { ChainSwitcher } from "@/components/chain-switcher";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link aria-label="My Wallet home" className="brand" href="/">
        <span aria-hidden="true" className="brand-mark">
          W
        </span>
        <span>my wallet</span>
      </Link>
      <div className="header-tools">
        <ChainSwitcher />
      </div>
    </header>
  );
}
