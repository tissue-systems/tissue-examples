const HTML = `<!doctype html>
<html lang="en-us" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Live Demos | Tissue</title>
  <meta name="description" content="Sample Cells running live on Tissue — edge functions deployed in seconds.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap"></noscript>
  <style>
    /* ── tokens ── */
    :root {
      --bg:             #ffffff;
      --bg-secondary:   #f6f9fc;
      --text:           #0a2540;
      --text-secondary: #425466;
      --text-tertiary:  #697386;
      --accent:         #5469d4;
      --accent-dark:    #3d4eac;
      --accent-light:   #eef2ff;
      --border:         #e3e8ee;
      --border-light:   #f0f4f8;
      --header-h:       64px;
      --max-width:      1175px;
      --font-body:      "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", Ubuntu, sans-serif;
      --font-code:      "JetBrains Mono", "Menlo", "Consolas", "Liberation Mono", Courier, monospace;
      --radius:         4px;
      --radius-md:      6px;
      --radius-lg:      8px;
    }

    /* ── reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    html { font-size: 16px; -webkit-text-size-adjust: 100% }
    body {
      font-family: var(--font-body);
      font-size: 15px;
      line-height: 1.6;
      color: var(--text);
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }
    img, svg { display: block; max-width: 100% }
    a { color: var(--accent); text-decoration: none }
    a:hover { text-decoration: underline }

    /* ── header ── */
    header {
      height: var(--header-h);
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .header-inner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      max-width: 860px;
      margin: 0 auto;
      padding: 0 2rem;
      height: 100%;
    }
    .logo { font-size: 0.9375rem; font-weight: 600; color: var(--text); text-decoration: none; letter-spacing: -0.01em }
    .logo:hover { text-decoration: none; color: var(--text) }
    .login-btn {
      font-size: 0.8125rem;
      font-weight: 500;
      padding: 0.4rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text-secondary);
      background: var(--bg);
      text-decoration: none;
      transition: border-color .15s, color .15s, background .15s;
      display: inline-flex;
      align-items: center;
    }
    .login-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-light); text-decoration: none }

    /* ── footer ── */
    footer { padding: 1.5rem 2rem; border-top: 1px solid var(--border); text-align: center }
    footer a { font-size: 0.8125rem; color: var(--text-secondary); text-decoration: none; transition: color .15s }
    footer a:hover { color: var(--text) }

    /* ── main ── */
    main { max-width: 860px; margin: 0 auto; padding: 4rem 2rem 6rem }

    /* hero */
    .hero { margin-bottom: 4rem }
    .hero h1 {
      font-size: clamp(1.75rem, 4vw, 2.75rem);
      font-weight: 600;
      line-height: 1.15;
      letter-spacing: -0.025em;
      color: var(--text);
      margin-bottom: 1rem;
    }
    .hero .tagline { font-size: 1.125rem; color: var(--text-secondary); font-weight: 400; line-height: 1.6 }
    .hero .tagline .tech { color: var(--text); font-weight: 500 }

    section { margin-bottom: 3rem }
    h2 {
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-secondary);
      margin-bottom: 1rem;
    }
    p { margin-bottom: 1rem; font-size: 0.9375rem; line-height: 1.7; color: var(--text) }

    code {
      font-family: var(--font-code);
      font-size: 0.8125em;
      background: #f6f9fc;
      color: #3c4257;
      border: 1px solid #dde1ea;
      padding: 0.1em 0.38em;
      border-radius: var(--radius);
    }

    /* ── demo grid ── */
    .demo-grid { display: flex; flex-direction: column; gap: 0.85rem }

    .cell-card {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.2rem;
      transition: border-color 0.15s, background-color 0.15s;
    }
    .cell-card:hover { border-color: var(--accent); background-color: var(--bg-secondary) }

    .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem }
    .cell-name { font-size: 0.9rem; font-weight: 500 }
    .tag-row { display: flex; gap: 0.25rem; flex-shrink: 0 }
    .tag {
      font-size: 0.58rem; font-weight: 500; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 0.15rem 0.45rem; border-radius: 3px;
      white-space: nowrap;
    }
    .tag-js    { background: #fef9ec; color: #92640a; border: 1px solid #fde8a0 }
    .tag-ts    { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe }
    .tag-wasm  { background: #f0f0ff; color: #4040cc; border: 1px solid #d0d0f0 }
    .tag-c3    { background: #edfaf3; color: #1a7f4b; border: 1px solid #b7ecd0 }
    .tag-files { background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa }

    .card-desc { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6; flex: 1; margin: 0 }

    .tech-row { display: flex; gap: 0.3rem; flex-wrap: wrap }
    .tech {
      font-size: 0.62rem; padding: 0.1rem 0.4rem;
      border: 1px solid var(--border); border-radius: 3px;
      color: var(--text-secondary);
    }

    .card-links {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding-top: 0.65rem;
      border-top: 1px solid var(--border);
      margin-top: 0.1rem;
    }
    .btn-visit, .btn-source {
      font-family: var(--font-code);
      font-size: 0.72rem;
      font-weight: 500;
      padding: 0.3rem 0.75rem;
      border-radius: 4px;
      text-decoration: none;
      transition: background 0.12s, color 0.12s;
    }
    .btn-visit { border: 1px solid var(--accent); color: var(--accent) }
    .btn-visit:hover { background: var(--accent); color: #fff }
    .btn-source { border: 1px solid var(--border); color: var(--text-secondary) }
    .btn-source:hover { border-color: var(--text-secondary); color: var(--text) }

    .section-gap { margin-top: 2.5rem }

    .deploy-note { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border) }
    .deploy-note p { font-size: 0.82rem; color: var(--text-secondary); margin: 0; line-height: 1.7 }
    .deploy-note a { color: var(--accent); text-decoration: none }
    .deploy-note a:hover { text-decoration: underline }

    @media (max-width: 600px) {
      .header-inner { padding: 0 1.25rem }
      main { padding: 2.5rem 1.25rem 4rem }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <a href="https://tissue.systems" class="logo">Tissue</a>
      <a href="https://tissue.systems/login" class="login-btn">Login</a>
    </div>
  </header>

  <main>
    <div class="hero">
      <h1>Live Demos</h1>
      <p class="tagline">Sample Cells running on <span class="tech">Tissue</span> — each deployed in seconds with <code>ribo deploy</code>.</p>
    </div>

    <section>
      <h2>JavaScript</h2>
      <div class="demo-grid">

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">hello</span>
            <div class="tag-row"><span class="tag tag-js">JS</span></div>
          </div>
          <p class="card-desc">Minimal Cell — routing, JSON responses, and an echo endpoint. The shortest path from <code>ribo deploy</code> to a live API.</p>
          <div class="tech-row">
            <span class="tech">routing</span>
            <span class="tech">JSON responses</span>
            <span class="tech">echo</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://hello.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/js-hello" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">static-ping</span>
            <div class="tag-row"><span class="tag tag-js">JS</span></div>
          </div>
          <p class="card-desc">Static HTML page with a JSON API endpoint. Click a button to ping the cell and see method, timestamp, and response directly in the page.</p>
          <div class="tech-row">
            <span class="tech">static HTML</span>
            <span class="tech">REST API</span>
            <span class="tech">fetch handler</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://static-ping.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/js-static-ping" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">c3-notes</span>
            <div class="tag-row">
              <span class="tag tag-js">JS</span>
              <span class="tag tag-c3">C3</span>
            </div>
          </div>
          <p class="card-desc">Persistent notes app backed by a C3 SQLite database. Create and delete notes — data survives redeploys, scoped to the cell owner.</p>
          <div class="tech-row">
            <span class="tech">C3 SQLite</span>
            <span class="tech">CRUD</span>
            <span class="tech">persistent storage</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://c3-notes.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/js-c3-notes" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">notes</span>
            <div class="tag-row">
              <span class="tag tag-js">JS</span>
              <span class="tag tag-c3">C3</span>
            </div>
          </div>
          <p class="card-desc">Full CRUD notes REST API in plain JavaScript. Create, read, update, and delete notes with a C3 SQLite database — no framework, no dependencies.</p>
          <div class="tech-row">
            <span class="tech">REST API</span>
            <span class="tech">C3 SQLite</span>
            <span class="tech">CRUD</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://notes.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/js-notes" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">url-shortener</span>
            <div class="tag-row">
              <span class="tag tag-js">JS</span>
              <span class="tag tag-c3">C3</span>
            </div>
          </div>
          <p class="card-desc">URL shortener that creates short codes, issues 301 redirects, and tracks click counts in C3. Custom codes supported; conflict detection on duplicates.</p>
          <div class="tech-row">
            <span class="tech">301 redirects</span>
            <span class="tech">C3 SQLite</span>
            <span class="tech">click tracking</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://url-shortener.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/js-url-shortener" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">api-racer</span>
            <div class="tag-row"><span class="tag tag-js">JS</span></div>
          </div>
          <p class="card-desc">Fans out to 6 public APIs simultaneously from the Tissue edge and measures per-API latency. Shows the parallelism factor vs sequential execution.</p>
          <div class="tech-row">
            <span class="tech">Promise.all</span>
            <span class="tech">concurrent fetch</span>
            <span class="tech">latency benchmark</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://api-racer.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/js-api-racer" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">growzone</span>
            <div class="tag-row"><span class="tag tag-js">JS</span></div>
          </div>
          <p class="card-desc">USDA Plant Hardiness Zone lookup by US zip code. Enter any 5-digit zip to see your grow zone, temperature range, and frost dates from the 2023 USDA map embedded in the cell.</p>
          <div class="tech-row">
            <span class="tech">USDA 2023 data</span>
            <span class="tech">embedded dataset</span>
            <span class="tech">esbuild bundle</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://growzone.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/js-growzone" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">llm-chat</span>
            <div class="tag-row">
              <span class="tag tag-js">JS</span>
              <span class="tag tag-c3">C3</span>
            </div>
          </div>
          <p class="card-desc">Stateless LLM chat Cell. Each request is independent — no history between calls. API key stored in C3, never in source.</p>
          <div class="tech-row">
            <span class="tech">Anthropic API</span>
            <span class="tech">C3 key storage</span>
            <span class="tech">stateless</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://llm-chat.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/js-llm-chat" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">agent</span>
            <div class="tag-row">
              <span class="tag tag-js">JS</span>
              <span class="tag tag-c3">C3</span>
            </div>
          </div>
          <p class="card-desc">Stateful AI agent with per-session conversation memory persisted in C3. Session history is replayed on every turn; multiple sessions are fully isolated.</p>
          <div class="tech-row">
            <span class="tech">Anthropic API</span>
            <span class="tech">session memory</span>
            <span class="tech">C3 SQLite</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://agent.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/js-ai-agent" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">flower-farm</span>
            <div class="tag-row">
              <span class="tag tag-js">JS</span>
              <span class="tag tag-c3">C3</span>
              <span class="tag tag-files">FILES</span>
            </div>
          </div>
          <p class="card-desc">Flower farm website with live inventory and a visitor waitlist. Stock badges are rendered server-side from C3 on every request. Visitors sign up to be notified when a flower is back — entries land in C3. Includes an <a href="https://flower-farm.bestow-75.tissue.dev/admin" target="_blank" rel="noopener">admin dashboard</a> showing signups and demand per flower.</p>
          <div class="tech-row">
            <span class="tech">live stock badges</span>
            <span class="tech">waitlist → C3</span>
            <span class="tech">admin dashboard</span>
            <span class="tech">FILES binding</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://flower-farm.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-visit" href="https://flower-farm.bestow-75.tissue.dev/admin" target="_blank" rel="noopener">↗ Visit site admin panel</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/js-flower-farm" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

      </div>
    </section>

    <section class="section-gap">
      <h2>Rust → WebAssembly</h2>
      <div class="demo-grid">

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">fib</span>
            <div class="tag-row"><span class="tag tag-wasm">WASM</span></div>
          </div>
          <p class="card-desc">Fibonacci in Rust/WASM. Computes fib(n) for n up to 93 in Rust and returns the exact result as a string — avoiding IEEE 754 precision loss for large values.</p>
          <div class="tech-row">
            <span class="tech">wasm-bindgen</span>
            <span class="tech">u64 precision</span>
            <span class="tech">fetch handler</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://fib.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/rust-fib" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">primes</span>
            <div class="tag-row"><span class="tag tag-wasm">WASM</span></div>
          </div>
          <p class="card-desc">Prime counter using async Rust futures compiled to WASM. Demonstrates that CPU-bound futures are cooperative, not parallel — join runs them sequentially.</p>
          <div class="tech-row">
            <span class="tech">Rust async</span>
            <span class="tech">wasm-bindgen-futures</span>
            <span class="tech">cooperative futures</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://primes.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/rust-primes" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">analyst</span>
            <div class="tag-row"><span class="tag tag-wasm">WASM</span></div>
          </div>
          <p class="card-desc">Text analysis Cell running four passes concurrently via <code>future::join4</code> and <code>yield_now()</code>. Makes cooperative multitasking visible in the response.</p>
          <div class="tech-row">
            <span class="tech">future::join4</span>
            <span class="tech">yield_now</span>
            <span class="tech">cooperative scheduling</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://analyst.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/rust-analyst" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">phonebook</span>
            <div class="tag-row">
              <span class="tag tag-wasm">WASM</span>
              <span class="tag tag-c3">C3</span>
            </div>
          </div>
          <p class="card-desc">Contacts CRUD API written in Rust, compiled to WASM. Rust equivalent of js-notes — same API surface, different implementation language, C3 for persistence.</p>
          <div class="tech-row">
            <span class="tech">Rust</span>
            <span class="tech">serde_json</span>
            <span class="tech">C3 SQLite</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://phonebook.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/rust-phonebook" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">spellcheck</span>
            <div class="tag-row"><span class="tag tag-wasm">WASM</span></div>
          </div>
          <p class="card-desc">Levenshtein edit-distance spell checker compiled from Rust to WASM. Searches a 210k-word dictionary embedded in the binary — all computation in Rust, zero JS business logic.</p>
          <div class="tech-row">
            <span class="tech">Rust</span>
            <span class="tech">wasm-bindgen</span>
            <span class="tech">Levenshtein DP</span>
            <span class="tech">210k words</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://spellcheck.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/rust-spellcheck" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">spfchecker</span>
            <div class="tag-row"><span class="tag tag-wasm">WASM</span></div>
          </div>
          <p class="card-desc">SPF DNS record validator. Browser fetches TXT records from 1.1.1.1 DoH and follows <code>include:</code> chains recursively; Rust validates against RFC 7208 — 10-lookup limit, syntax errors, dangerous configurations.</p>
          <div class="tech-row">
            <span class="tech">Rust</span>
            <span class="tech">RFC 7208</span>
            <span class="tech">DNS-over-HTTPS</span>
            <span class="tech">recursive lookup</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://spfchecker.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/rust-spfchecker" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

      </div>
    </section>

    <section class="section-gap">
      <h2>TypeScript</h2>
      <div class="demo-grid">

        <div class="cell-card">
          <div class="card-head">
            <span class="cell-name">ts-events-api</span>
            <div class="tag-row">
              <span class="tag tag-ts">TS</span>
              <span class="tag tag-c3">C3</span>
            </div>
          </div>
          <p class="card-desc">Typed events/calendar REST API written in TypeScript. Compiled to JS via esbuild as a <code>ribo.toml</code> build step — the TS source never leaves your machine.</p>
          <div class="tech-row">
            <span class="tech">TypeScript</span>
            <span class="tech">esbuild</span>
            <span class="tech">C3 SQLite</span>
            <span class="tech">REST API</span>
          </div>
          <div class="card-links">
            <a class="btn-visit" href="https://events.bestow-75.tissue.dev" target="_blank" rel="noopener">↗ Visit</a>
            <a class="btn-source" href="https://github.com/tissue-systems/tissue-examples/tree/main/ts-events-api" target="_blank" rel="noopener">{ } Source</a>
          </div>
        </div>

      </div>
    </section>

    <div class="deploy-note">
      <p>
        All cells deployed with <code>ribo deploy</code> from a <code>ribo.toml</code>.
        Full source at <a href="https://github.com/tissue-systems/tissue-examples" target="_blank" rel="noopener">github.com/tissue-systems/tissue-examples</a>.
        Sign up at <a href="https://tissue.systems">tissue.systems</a> to deploy your own.
      </p>
    </div>
  </main>

  <footer>
    <a href="https://tissue.systems">tissue.systems</a>
  </footer>
</body>
</html>`;

export default {
  async fetch(request) {
    return new Response(HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
