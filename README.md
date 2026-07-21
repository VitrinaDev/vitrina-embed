# vitrina-embed

The code that runs on **the dealer's own website**, not ours: an embeddable AI
chat widget that drops into any page and lands the conversation in the dealer's
Vitrina inbox.

Published to public npm under the `@vitrina` scope — a dealer's developer
installs it with no auth, no account, and no build step if they don't want one.

## Install it in thirty seconds

```html
<script>
  window.vitrinaChat = {
    publicKey: 'pk_live_xxx',
    apiBaseUrl: 'https://api.vitrinadev.com/api/v1',
  };
</script>
<script src="https://api.vitrinadev.com/widget.js" defer></script>
```

That is the whole install, and it is deliberately the whole install. Colour,
corner, logo, greeting and language are **not** in there — they are configured in
Vitrina (*Configuración › Conexiones › Web chat*) and fetched at load, so the
dealer restyles their bubble from the admin UI and this page never changes again.

Building your site with a bundler? `npm install @vitrina/widget` and
`import { init } from '@vitrina/widget'` instead. Same widget, same config.

Full options, the imperative handle (`open()` / `close()` / `setVehicle()` /
`destroy()`), and the security notes live in
**[`packages/widget/README.md`](packages/widget/README.md)**.

## Packages

| Package | What it is | Status |
|---|---|---|
| [`@vitrina/widget`](packages/widget) | The embeddable chat widget: Shadow-DOM launcher + conversation panel, SSE transport, server-resolved theming, and a `<script>` loader for no-build sites. | **shipped** — [![npm](https://img.shields.io/npm/v/@vitrina/widget.svg)](https://www.npmjs.com/package/@vitrina/widget) |

Reserved for later, and deliberately not scaffolded until something needs them:
`@vitrina/react` (headless hooks) and `@vitrina/stock-ui` (themeable stock
components) for the Vitrina-built storefront templates.

## How it works

The widget authenticates with a **publishable widget key** (`pk_…`, origin-locked
— Vitrina ADR 0033) and speaks the **`web` channel** protocol (anonymous ingress
+ visitor-scoped SSE — ADR 0032):

```
                    ┌──► GET  /widget/config          what should I look like?  (ADR 0046)
                    │
dealer's page ──────┼──► POST /widget/conversations   who is this visitor?
 (pk_ key +         │
  visitor token)    ├──► POST /widget/messages        the visitor said this
                    │
                    └──◄  GET /widget/stream          SSE: something changed
                                 │                          (payload-free)
                                 └──► GET /widget/messages   ← fetch the text
```

Three properties are worth knowing before changing anything here:

- **The stream carries no text.** An SSE frame says *something happened*; the
  widget then re-fetches history. That keeps message content on exactly one
  authenticated path, and makes reconnect-and-catch-up the normal case rather
  than a special one.
- **Appearance is server-resolved, but inline still wins.** Anything set in
  `window.vitrinaChat` overrides what the server serves. That ordering is what
  let server-side theming ship without restyling a single existing install. It
  also **fails open**: a network error, an older API, a malformed answer — the
  widget renders with inline/defaults and works normally.
- **AI auto-reply is per-dealer and defaults OFF.** Out of the box the visitor is
  talking to a human through the dealer's inbox. Replies arrive over the same
  SSE→refetch path either way, so turning AI on later needs no widget change.

### Is the key sitting in the page a problem?

No — that is what it is for. `pk_` is a **publishable** credential: a stateless,
origin-locked HMAC token granting only `stock:read` + `leads:intake` +
`widget:chat`, and only on the domains baked into it at mint time. A key lifted
from `dealerA.cl` is inert anywhere else. Its security is the server-side origin
lock, never secrecy.

### Safety

Message content reaches the DOM only as text nodes, or as elements built by the
safe-subset markdown renderer — no `innerHTML` anywhere, no `eval`, no remote
script or style. Every dealer-supplied value (accent colour, logo URL, link
targets) passes a sanitizer before it touches the page, and an unusable one falls
back to a default rather than being injected.

## Development

```bash
pnpm install
pnpm -r build        # tsup → dist/index.js (ESM) + dist/loader.global.js (IIFE)
pnpm -r test         # vitest + happy-dom — 173 tests across 17 files
pnpm -r typecheck
```

The tests are the contract. They drive a real `init()` against a mocked fetch and
pin down the things that are expensive to get wrong: a visitor's message is never
lost on a failed send, a failed history fetch repaints nothing, injected HTML in
a reply stays a text node, and the config fetch fails open.

## Releasing

```bash
# bump packages/widget/package.json + CHANGELOG.md, commit, then:
git tag v0.3.1 && git push origin v0.3.1
```

A `v*` tag triggers `.github/workflows/publish.yml`, which verifies the tag
matches `package.json`, builds, runs the suite, and publishes to npm with
provenance via OIDC trusted publishing — no token, no OTP prompt. A mismatched
tag fails loudly instead of silently republishing. See
[`PUBLISHING.md`](PUBLISHING.md).

**Publishing to npm does not by itself reach `<script>`-tag dealers.**
`https://api.vitrinadev.com/widget.js` is served out of `vitrina-app`'s
`node_modules` at an unversioned URL, so what actually reaches them is the
**dependency bump in `vitrina-app`** — visible in a diff, bumped deliberately.
npm consumers (storefront templates) upgrade on their own schedule.

## Backend contract

`vitrina-app`, in `docs/adr/`: **0032** (embeddable webchat channel), **0033**
(publishable widget key), **0035** (visitor realtime closed vocabulary), **0046**
(server-resolved widget appearance). The wire types in
`packages/widget/src/config.ts` mirror `src/api/schemas/widget-chat.ts` there —
keep them in sync.
