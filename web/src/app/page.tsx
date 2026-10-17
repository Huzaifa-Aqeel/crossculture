import Link from "next/link";
import { ArrowRight, ArrowUpRight, MoveUpRight } from "lucide-react";
import { Header } from "@/components/header";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <section className="hero shell">
          <div className="hero-main">
            <div className="eyebrow"><span className="eyebrow-dot" /> Partnership intelligence, with perspective</div>
            <h1>Find the collaboration no one saw coming.</h1>
            <p className="hero-copy">Discover partners who share a cultural connection, bring something different to the table, and can make something worthwhile together.</p>
            <div className="hero-actions">
              <Link className="button button-dark" href="/discover">Find collaborators <ArrowUpRight size={18} strokeWidth={1.8} /></Link>
              <a className="button button-outline" href="#how-it-works">See how it works</a>
            </div>
          </div>
          <div className="hero-aside">
            <div className="aside-rule" />
            <p>Good partnerships start with more than a shared category. They start with a reason people will care.</p>
            <span>Explore the connection. Shape the idea. Make the introduction count.</span>
          </div>
        </section>

        <section className="showcase-wrap">
          <div className="shell showcase">
            <div className="showcase-topline"><span>THE WORKSPACE</span><span>01 / DISCOVER</span></div>
            <div className="showcase-grid">
              <div className="showcase-intro">
                <div className="showcase-kicker">A clearer starting point</div>
                <h2>Make the connection visible.</h2>
                <p>Look beyond obvious competitors and adjacent audiences. See what connects two worlds, where each partner adds value, and what the collaboration could become.</p>
                <Link href="/discover" className="text-link">Open the workspace <ArrowRight size={18} /></Link>
              </div>
              <div className="sample-card" aria-label="Illustrative collaboration preview">
                <div className="sample-label"><span className="sample-pulse" /> Illustrative opportunity</div>
                <div className="sample-entities"><div className="sample-avatar">O</div><span className="sample-x">×</span><div className="sample-avatar sample-avatar-alt">F</div></div>
                <h3>Outdoor culture meets visual storytelling.</h3>
                <p>An outdoor brand and a travel filmmaker could document the places people go to feel connected.</p>
                <div className="sample-divider" />
                <div className="sample-meta"><span>Cultural connection</span><strong>Exploration · Community · Storytelling</strong></div>
                <div className="sample-meta"><span>Possible format</span><strong>Short films + local community screenings</strong></div>
                <div className="sample-footnote">Example concept for illustration only</div>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="shell process-section">
          <div className="section-heading"><span className="section-index">HOW IT WORKS / 02</span><h2>From interesting match<br />to a real idea.</h2></div>
          <div className="process-grid">
            <article className="process-item"><span className="process-number">01</span><h3>Start with your brand</h3><p>Tell us whether you want to find another brand or a YouTube creator.</p></article>
            <article className="process-item"><span className="process-number">02</span><h3>See the connection</h3><p>Review potential partners, the cultural threads between them, and the practical questions worth asking.</p></article>
            <article className="process-item"><span className="process-number">03</span><h3>Shape what comes next</h3><p>Turn a promising match into a concrete collaboration direction, then refine the next round with your feedback.</p></article>
          </div>
        </section>

        <section className="shell final-cta">
          <div><span className="section-index">A BETTER WAY TO BEGIN</span><h2>Find common ground.<br />Create something new.</h2></div>
          <Link className="button button-light" href="/discover">Explore partnerships <MoveUpRight size={19} /></Link>
        </section>
      </main>
      <footer className="site-footer shell"><span>CrossCulture © 2026</span><span>Better partnerships begin with better questions.</span></footer>
    </>
  );
}
