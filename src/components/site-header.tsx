import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link aria-label="My Wallet home" className="brand" href="/">
        <span aria-hidden="true" className="brand-mark">
          W
        </span>
        <span>my wallet</span>
      </Link>
      <nav aria-label="Main navigation" className="header-nav">
        <Link href="/wallet">Wallet</Link>
        <Link href="/send">Send</Link>
      </nav>
    </header>
  );
}
