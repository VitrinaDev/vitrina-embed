# @vitrina/widget

Embeddable chat widget for dealer websites. Renders a floating launcher + a
conversation panel inside a **Shadow DOM** (fully style-isolated from the host
page) and speaks the Vitrina `web` channel protocol: it creates/resumes an
anonymous visitor conversation, POSTs messages, and subscribes to a
visitor-scoped **SSE** stream that invalidates so the widget re-fetches history —
all authenticated with a publishable, origin-locked widget key (`pk_…`).

Two ways to embed: an **NPM import** (`import { init }`) for app/storefront
codebases, or a **`<script>` loader** for any static site.

---

## Install

This package is published to the **public npm registry** under the `@vitrina`
org scope. No authentication or `.npmrc` configuration is required.

### Option A — NPM import (app/storefront codebases)

```bash
npm install @vitrina/widget
# or: pnpm add @vitrina/widget
# or: yarn add @vitrina/widget
```

### Option B — `<script>` loader (any static site, no build step)

```html
<script>
  window.vitrinaChat = {
    publicKey: 'pk_live_xxx',
    apiBaseUrl: 'https://api.vitrinadev.com/api/v1',
  };
</script>
<script src="https://unpkg.com/@vitrina/widget/dist/loader.global.js" defer></script>
```

See "Usage — `<script>` loader" below for the full config.

---

## Usage — `import { init }`

```ts
import { init } from '@vitrina/widget';

const widget = init({
  publicKey: 'pk_live_xxx',
  apiBaseUrl: 'https://app.vitrina.dev/api/v1',
  vehicleId: 'veh_123',            // optional: pre-attach the inquiry to a vehicle
  locale: 'es',                    // optional: 'es' | 'en' (auto-detected otherwise)
  theme: { accent: '#2563eb', position: 'br', logoUrl: 'https://…/logo.png' },
  welcomeMessage: 'Hola, ¿en qué te puedo ayudar?',
});

// The returned handle lets you drive the widget imperatively:
widget.open();
widget.setVehicle('veh_456');      // e.g. on an SPA route change
widget.close();
widget.destroy();                  // unmounts + aborts the SSE stream
```

The widget mounts itself on `init()`; nothing else is required.

---

## Usage — `<script>` loader

For any site (no build step). Set `window.vitrinaChat` **before** the loader
script, and it auto-initializes:

```html
<script>
  window.vitrinaChat = {
    publicKey: 'pk_live_xxx',
    apiBaseUrl: 'https://api.vitrinadev.com/api/v1',
    // optional:
    vehicleId: 'veh_123',
    locale: 'es',
    theme: { accent: '#2563eb', position: 'br', logoUrl: 'https://…/logo.png' },
    welcomeMessage: 'Hola, ¿en qué te puedo ayudar?',
  };
</script>
<script src="https://your-cdn/loader.global.js" defer></script>
```

The `window.vitrinaChat` object is exactly the config table below. After load, the
live handle is stashed on `window.vitrinaChatInstance`, so the host page can call
`window.vitrinaChatInstance.open()` / `.close()` / `.setVehicle(id)` / `.destroy()`.

The loader is defensive: it `console.warn`s and no-ops on a missing/invalid config,
is idempotent against a double-load, and never throws into the host page.

---

## Configuration options

| Option           | Type                          | Required | Default            | Description                                                                 |
| ---------------- | ----------------------------- | -------- | ------------------ | --------------------------------------------------------------------------- |
| `publicKey`      | `string`                      | **yes**  | —                  | Publishable widget key (`pk_…`), origin-locked. Safe to ship in page source. |
| `apiBaseUrl`     | `string`                      | **yes**  | —                  | Vitrina API base, e.g. `https://<host>/api/v1`. Trailing slash is trimmed.  |
| `vehicleId`      | `string`                      | no       | `null`             | Pre-attach the inquiry to a vehicle (the `id` from `/stock`).               |
| `locale`         | `'es' \| 'en'`                | no       | auto (`navigator`) | Widget chrome language. Falls back to `es` (Chilean market default).        |
| `theme.accent`   | `string` (CSS color)          | no       | `#111827`          | Brand accent for the launcher + inbound bubbles. Sanitized; bad values fall back. |
| `theme.position` | `'br' \| 'bl'`                | no       | `'br'`             | Launcher corner: bottom-right or bottom-left.                               |
| `theme.logoUrl`  | `string` (http/https URL)     | no       | —                  | Optional logo in the panel header. Non-http(s) URLs are ignored.            |
| `welcomeMessage` | `string`                      | no       | localized greeting | Greeting shown before the visitor sends the first message.                  |

Message content is **never** parsed as HTML — every bubble is written via
`textContent`, so it is XSS-safe by construction.

---

## Security

- **`pk_` is public by design.** It is safe to ship in page source: it only works
  on the dealer's allow-listed origins (origin-locked, Vitrina ADR 0033) and only
  grants `stock:read` + `leads:intake` + `widget:chat`. It is **not** a secret and
  carries no admin capability.
- **Origin lock + CORS.** Requests only succeed from the domains configured for
  that key; the widget sends a fixed, minimal header set (`Authorization`,
  `Content-Type`, `X-Vitrina-Visitor`) and never `credentials: 'include'`.
- **AI kill-switch defaults OFF.** With AI answers off, a visitor talks to a human
  via the dealer inbox; replies arrive over the same SSE→refetch path once the
  dealer enables AI later — no widget change needed.
- **Honeypot.** The composer includes a hidden `hp_website` field (visually hidden
  off-screen, never `display:none`) that is always submitted — empty for a human,
  a spam signal when a bot fills it.

---

## Browser support

Evergreen browsers (Chrome/Edge, Firefox, Safari, and their mobile equivalents).
The widget requires Shadow DOM, `fetch` with streaming `ReadableStream` bodies
(for SSE), `AbortController`, and CSS custom properties — all baseline in browsers
from ~2020 onward. No IE11 support.

---

## Development

```bash
pnpm build       # tsup → dist/ (ESM library + IIFE loader + .d.ts)
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest (happy-dom)
```
