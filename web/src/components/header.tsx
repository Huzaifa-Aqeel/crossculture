import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function Header() {
  return (
    <header className="site-header shell">
      <Link href="/" className="brand" aria-label="CrossCulture home"><span className="brand-mark"><i /><i /></span><span>CrossCulture<span className="brand-period">.</span></span></Link>
      <nav aria-label="Primary navigation"><Link href="/#how-it-works">How it works</Link><Link href="/account">Workspace</Link><Link href="/youtube">Creators</Link><Link href="/auth">Sign in</Link></nav>
      <Link href="/account" className="header-cta">Get started <ArrowUpRight size={16} /></Link>
    </header>
  );
}
