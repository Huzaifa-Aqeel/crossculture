import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Header } from "@/components/header";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <section className="hero shell">
          <div className="hero-main">
            <h1>Find the collaboration no one saw coming.</h1>
            <p className="hero-copy">Discover partners who share a cultural connection, bring something different to the table, and can make something worthwhile together.</p>
            <div className="hero-actions">
              <Link className="button button-dark" href="/account">Find brand partners <ArrowUpRight size={18} strokeWidth={1.8} /></Link>
              <a className="button button-outline" href="#how-it-works">See how it works</a>
            </div>
          </div>
        </section>

        <section className="showcase-wrap">
          <div className="shell showcase">
            <div className="showcase-grid">
              <div className="showcase-intro">
                <h2>Make the connection visible.</h2>
                <p>Look beyond obvious competitors and adjacent audiences. See what connects two worlds, where each partner adds value, and what the collaboration could become.</p>
              </div>
              <div className="sample-card" aria-label="Illustrative collaboration preview">
                <div className="sample-entities"><div className="sample-avatar">A</div><span className="sample-x">×</span><div className="sample-avatar sample-avatar-alt">B</div></div>
                <h3>Two products, one useful pairing.</h3>
                <p>A brand partnership can combine complementary products into a bundle worth exploring.</p>
                <div className="sample-divider" />
                <div className="sample-meta"><span>Cultural connection</span><strong>A specific shared interest to verify</strong></div>
                <div className="sample-meta"><span>Possible format</span><strong>Product bundle or cross-sell</strong></div>
                <div className="sample-footnote">Example concept for illustration only</div>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="shell process-section">
          <div className="section-heading"><h2>From interesting match<br />to a real idea.</h2></div>
          <div className="process-grid">
            <article className="process-item"><span className="process-number">01</span><h3>Start with your brand</h3><p>Choose a product bundle or cross-sell goal.</p></article>
            <article className="process-item"><span className="process-number">02</span><h3>See the connection</h3><p>Review potential partners, the cultural threads between them, and the practical questions worth asking.</p></article>
            <article className="process-item"><span className="process-number">03</span><h3>Shape what comes next</h3><p>Turn a promising match into a concrete collaboration direction, then refine the next round with your feedback.</p></article>
          </div>
        </section>

      </main>
      <footer className="site-footer shell"><span>CrossCulture © 2026</span></footer>
    </>
  );
}
