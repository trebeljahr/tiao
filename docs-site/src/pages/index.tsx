import type { ReactNode } from "react";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header
      style={{
        padding: "4rem 0",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            justifyContent: "center",
            marginTop: "1.5rem",
          }}
        >
          <Link className="button button--primary button--lg" to="/docs/">
            Get Started
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/api-reference/tiao-api">
            API Reference
          </Link>
        </div>
      </div>
    </header>
  );
}

const features = [
  {
    title: "Real-time Multiplayer",
    description:
      "Play online with friends or get matched with opponents. WebSocket-powered real-time gameplay with optimistic updates.",
  },
  {
    title: "Pure Game Engine",
    description:
      "The game rules are pure TypeScript functions with zero side effects. Shared between client and server for consistent validation.",
  },
  {
    title: "Open Source",
    description:
      "MIT licensed. Contribute game features, improve the AI, build alternative clients, or deploy your own instance.",
  },
];

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title="Home" description={siteConfig.tagline}>
      <HomepageHeader />
      <main>
        <section style={{ padding: "2rem 0" }}>
          <div className="container">
            <div className="row">
              {features.map((feature, idx) => (
                <div key={idx} className="col col--4" style={{ padding: "1rem" }}>
                  <Heading as="h3">{feature.title}</Heading>
                  <p>{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
