# vitrina-embed

Embeddable web SDK for Vitrina dealer websites. Published to the public npm
registry under the `@vitrina` org scope.

## Packages

| Package | What it is | Status |
|---|---|---|
| `@vitrina/client` | Headless, framework-agnostic TS client for the Vitrina public API (stock read, lead submit, webchat transport). Generated from `openapi.json`. | scaffold |
| `@vitrina/widget` | The embeddable **chat widget** — launcher (Shadow DOM) + conversation panel (iframe), SSE client, config/theming, `<script>` loader. Talks to Vitrina Core with a publishable widget key. | **in progress (W6)** |

Later: `@vitrina/react` (headless hooks) and `@vitrina/stock-ui` (themeable
stock components) for the Vitrina-built storefront templates.

## Architecture

The widget authenticates with a **publishable widget key** (`pk_...`,
origin-locked — Vitrina ADR 0033) and speaks the **`web` channel** protocol
(anonymous ingress + visitor-scoped SSE — Vitrina ADR 0032):

```
visitor browser ──(pk_ key + visitor token)──► Vitrina Core /api/v1/widget/*
      ▲                                                    │
      └──────────── SSE (agent replies) ◄──────────────────┘
```

Live agent auto-reply is gated per-dealer and **defaults OFF** (human-only
inbox) until the dealer opts in.

## Development

```
pnpm install
pnpm -r build
```

Backend contract: see `docs/` in `vitrina-app` (ADR 0032 webchat, ADR 0033
widget key) and `openapi.json`.
