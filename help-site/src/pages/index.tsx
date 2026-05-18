import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

export default function Home(): React.JSX.Element {
  return (
    <Layout title="Toby documentation" description="Documentation for Toby CLI.">
      <main style={{padding: '3rem 1.25rem', maxWidth: 900, margin: '0 auto'}}>
        <h1>Toby Documentation</h1>
        <p>Documentation for installing and using the Toby CLI.</p>
        <p>
          Start with the <Link to="/docs/intro">Introduction and installation guide</Link>.
        </p>
      </main>
    </Layout>
  );
}
