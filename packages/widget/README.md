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
<script src="https://api.vitrinadev.com/widget.js" defer></script>
```

The loader is served by the same host the widget talks to, so a
Content-Security-Policy only ever needs one Vitrina origin:

```
script-src https://api.vitrinadev.com;
connect-src https://api.vitrinadev.com;
```

See "Usage — `<script>` loader" below for the full config.

---

## Usage — `import { init }`

```ts
import { init } from '@vitrina/widget';

const widget = init({
  publicKey: 'pk_live_xxx',
  apiBaseUrl: 'https://api.vitrinadev.com/api/v1',
  vehicleId: 'veh_123',            // optional: pre-attach the inquiry to a vehicle
  // Appearance is managed in Vitrina and fetched at load. Set any of these only
  // to OVERRIDE it for this site — an inline value always wins.
  locale: 'es',                    // optional: 'es' | 'en' (auto-detected otherwise)
  theme: { accent: '#2563eb', position: 'br' },
  logoUrl: 'https://…/logo.png',   // optional: your mark in the panel header
  font: 'dmSans',                  // optional: 'system' (default) or a named family
  bookingLabel: 'Agendar demo',    // optional: what the booking chip says
  welcomeMessage: 'Hola, ¿en qué te puedo ayudar?',
});

// The returned handle lets you drive the widget imperatively:
widget.open();
widget.setVehicle('veh_456');      // e.g. on an SPA route change
widget.openBooking();              // straight to the calendar (if the tenant has it)
widget.openHomeAction('sell');     // straight to a quick-action form
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
  };
</script>
<script src="https://api.vitrinadev.com/widget.js" defer></script>
```

That is the whole install. Appearance — colour, corner, logo, typeface,
greeting, language, what the booking chip is called, and whether the panel has
Home and Help tabs — is managed in Vitrina
(**Configuración › Conexiones › Web chat**) and
fetched at load, so changing it never means editing this page again. You can
still pin any of it inline, and an inline value always wins:

```html
<script>
  window.vitrinaChat = {
    publicKey: 'pk_live_xxx',
    apiBaseUrl: 'https://api.vitrinadev.com/api/v1',
    // optional, all overrides of what Vitrina serves:
    vehicleId: 'veh_123',
    locale: 'es',
    theme: { accent: '#2563eb', position: 'br' },
    logoUrl: 'https://…/logo.png',
    font: 'dmSans',
    bookingLabel: 'Agendar demo',
    welcomeMessage: 'Hola, ¿en qué te puedo ayudar?',
  };
</script>
<script src="https://api.vitrinadev.com/widget.js" defer></script>
```

`https://api.vitrinadev.com/widget.js` always serves the current release. The
URL is deliberately unversioned so a dealer never edits their HTML to receive a
fix; it is cached for five minutes and revalidated with an ETag. Pin a specific
version instead — `https://cdn.jsdelivr.net/npm/@vitrina/widget@0.3.0/dist/loader.global.js`
— only if you have a reason to hold one back.

The `window.vitrinaChat` object is exactly the config table below. After load, the
live handle is stashed on `window.vitrinaChatInstance`, so the host page can call
`window.vitrinaChatInstance.open()` / `.openBooking()` / `.close()` /
`.setVehicle(id)` / `.destroy()`.

The loader is defensive: it `console.warn`s and no-ops on a missing/invalid config,
is idempotent against a double-load, and never throws into the host page.

---

## Configuration options

| Option           | Type                          | Required | Default            | Description                                                                 |
| ---------------- | ----------------------------- | -------- | ------------------ | --------------------------------------------------------------------------- |
| `publicKey`      | `string`                      | **yes**  | —                  | Publishable widget key (`pk_…`), origin-locked. Safe to ship in page source. |
| `apiBaseUrl`     | `string`                      | **yes**  | —                  | Vitrina API base, e.g. `https://<host>/api/v1`. Trailing slash is trimmed.  |
| `vehicleId`      | `string`                      | no       | `null`             | Pre-attach the inquiry to a vehicle (the `id` from `/stock`).               |
| `vehicleLabel`   | `string`                      | no       | `null`             | Display title for `vehicleId`, e.g. `Toyota Yaris 2021`. Shown on the booking summary only when BOTH are set. |
| `locale`         | `'es' \| 'en'`                | no       | auto (`navigator`) | Widget chrome language. Falls back to `es` (Chilean market default).        |
| `theme.accent`   | `string` (CSS color)          | no       | `#111827`          | Brand accent for the launcher + inbound bubbles. Sanitized; bad values fall back. |
| `theme.position` | `'br' \| 'bl'`                | no       | `'br'`             | Launcher corner: bottom-right or bottom-left.                               |
| `theme.logoUrl`  | `string` (http/https URL)     | no       | —                  | Older spelling of `logoUrl` below. Still honoured; the top-level one wins.  |
| `logoUrl`        | `string` (http/https URL)     | no       | —                  | Logo in the panel header, ~22px tall, never cropped. Non-http(s) URLs are ignored — no logo, never a broken image. |
| `font`           | `WidgetFont`                  | no       | `'system'`         | Typeface for the whole widget. See **Fonts** below. Unknown values fall back to `system`. |
| `bookingLabel`   | `string`                      | no       | localized copy     | What the booking chip says, verbatim — e.g. `Agendar demo`. Trimmed; blank or over 40 chars falls back to the built-in copy. Only visible when the tenant has booking on. |
| `welcomeMessage` | `string`                      | no       | localized greeting | Greeting shown before the visitor sends the first message.                  |
| `home`           | `{ enabled?, title?, subtitle?, cards? }` | no | off          | The Home tab. See **Home and Help tabs** below. Off unless `enabled` is `true`. |
| `home.cards`     | `{ buy?, sell?, search? }`    | no       | all off            | The automotive quick actions. See **Quick actions** below. Each card is off unless its key is explicitly `true`. |
| `help`           | `{ enabled?, faqs? }`         | no       | off                | The Help tab (FAQ accordion). Off unless `enabled` is `true` **and** at least one usable question survives. |
| `team`           | `Array<{ name, avatarUrl? }>` | no       | `[]`               | Faces for the Home hero. Up to 5 accepted, first 3 drawn. Non-http(s) `avatarUrl` ⇒ initials. |
| `remoteConfig`   | `boolean`                     | no       | `true`             | Fetch appearance from Vitrina at load. `false` = fully self-contained.      |

### Booking ("Agendar visita", or whatever you call it)

There is no option for this. Booking is **server-gated per tenant**: `GET
/widget/config` answers `bookingEnabled` and nothing on the page can turn it on,
because the booking routes 404 for a tenant that has it off. When it is on, a
chip appears over the composer and opens a `fecha → hora → datos → resumen`
overlay laid over the panel; the conversation underneath is never destroyed.

A confirmed booking is kept in `localStorage` under
`vtr:widget:<pk_>:bookings` as a list of management tokens, which is how a
returning visitor sees and cancels their own visit with no account. Those
tokens are capabilities — the widget never renders one, never logs one, and
drops any the server stops resolving.

The chip's words come from the tenant: set `bookingLabel` (in Vitrina, or
inline) and the chip says exactly that — "Agendar demo", "Reservar hora",
"Book a test drive". It is used verbatim, in whatever language it is written in,
and a chrome-language change never rewrites it. The rest of the flow's copy is
deliberately neutral ("Mis reservas", "Confirmar reserva") so it still reads
correctly next to a label that is not about a visit.

Set `vehicleLabel` alongside `vehicleId` if you want the car named on the
booking summary; without a label the widget shows no vehicle line at all rather
than an empty card.

A host page with its own booking button opens the calendar directly:

```js
// true  → the visitor is looking at the calendar
// false → they got the conversation panel instead (tenant has booking off, or
//         GET /widget/config has not answered yet — in which case the calendar
//         still opens by itself once it does, unless the panel was closed)
const onCalendar = window.vitrinaChatInstance?.openBooking() ?? false;
```

The panel opens either way, because the conversation is the honest fallback: a
button that promised an agenda never leaves the visitor on the page they were
already on.

Message content is **never** parsed as HTML. A visitor's own text is written with
`textContent`; a reply goes through a safe-subset markdown renderer that
*constructs* DOM nodes and never produces an HTML string. There is no
`innerHTML` in the package, so an injected `<img onerror=…>` in a reply is a
text node, not an element — XSS-safe by construction rather than by escaping.

### Home and Help tabs

By default the panel is one view — the conversation — exactly as it has always
been. Turn on `home` and/or `help` and it grows a tab bar:

```json
{
  "home": { "enabled": true, "title": "¡Hola! 👋", "subtitle": "¿Cómo te podemos ayudar?" },
  "help": {
    "enabled": true,
    "faqs": [
      { "q": "¿Cómo agendo una visita?", "a": "Desde el botón **Agendar visita** eliges día y hora." },
      { "q": "¿Cuáles son los horarios?", "a": "Lunes a sábado, 9:30 a 19:00." }
    ]
  },
  "team": [
    { "name": "María Fernández", "avatarUrl": "https://cdn.dealer.cl/maria.jpg" },
    { "name": "Pedro Soto" }
  ]
}
```

That is the shape `GET /widget/config` sends, so this is set **in Vitrina** and
reaches installed widgets without anyone editing a page. The same keys work
inline as per-site overrides, and they merge field-wise: an inline
`home.title` beats the server's while the server's `home.enabled` still decides
whether the tab exists. `team` is the exception and replaces the server's list
wholesale — interleaving two rosters would produce a team that does not exist.

- **Home** is a hero in your accent colour (logo, an overlapping stack of up to
  three faces, greeting) with cards floating over its fade: the last message
  when there is a conversation to come back to, *Envíanos un mensaje* always,
  and the booking card only for a tenant whose agenda is on — titled with
  `bookingLabel`, never with our copy. `title` and `subtitle` are optional; both
  fall back to localized defaults.
- **Help** is an FAQ accordion. Answers are markdown (the same safe subset the
  chat renders — bold, italics, links, code, lists) and, like everything else in
  this package, become DOM nodes rather than an HTML string. Several answers can
  stand open at once, and one sticky button at the bottom drops the visitor into
  the composer.
- **Where the visitor lands.** Home, unless replies were waiting behind a closed
  panel — then Messages, because they came back to read something.

Caps and failure modes, all of them per-item rather than all-or-nothing:
`title` ≤ 80 chars, `subtitle` ≤ 120, up to 20 FAQs (`q` ≤ 200, `a` ≤ 2000),
up to 5 team members (`name` ≤ 40). A malformed FAQ entry is dropped on its own
and the rest still render; an over-long title falls back to the default instead
of being truncated mid-sentence; an `avatarUrl` that is not an absolute http(s)
URL becomes the member's initials on a stable colour, never a broken image.

The panel is 400×704 (up from 360×520) whether or not you use the tabs, and
still goes fullscreen at ≤480px.

### Quick actions — comprar, vender, lo buscamos por ti

Three more Home cards, each opening a short form **inside the panel** rather
than sending the visitor to a landing page:

```json
{ "home": { "enabled": true, "cards": { "buy": true, "sell": true, "search": true } } }
```

Opt-in per card, and the bag merges field-wise like everything else under
`home`: a page can pin one card on and still let Vitrina decide the other two.
Which cards a vertical turns on by default is decided server-side.

- **Comprar un auto** — nombre, teléfono, email (opcional), *¿qué auto buscas?*,
  presupuesto (opcional), consent.
- **¿No encuentras el auto que buscas?** — the same shape plus año and
  comentarios.
- **Vender tu auto** — four steps: *Tu auto* (patente, marca, modelo, año,
  kilómetros) → *Detalles* (versión, precio esperado, plazo de venta, región,
  comentarios) → *Fotos* (optional, up to 8, 10 MB each) → *Tus datos* (nombre,
  teléfono o email, consent).

**Where each one lands is the design.** Buy and search compose a message and
send it down the ordinary chat pipeline with the visitor's name and phone
attached — so it appears in the transcript, the dealer sees it in their inbox
like any other conversation, and the reply arrives where the visitor is already
looking. The overlay closes onto Mensajes; there is no separate "thanks" screen,
because the conversation is the confirmation.

Vender posts a real intake to `POST /widget/consignments` (multipart, photos
included) and earns a confirmation screen — a fresh row and a duplicate get the
same one, because the dealer already having the car is our bookkeeping, not the
visitor's problem. Photo caps are enforced in the browser and a rejected file is
named rather than silently dropped; nothing is lost on a refusal.

A host page with its own button opens a form directly, with the same semantics
as `openBooking()` (deferred intent included):

```js
// true  → the visitor is looking at that form
// false → they got the conversation panel instead (that card is off, or
//         GET /widget/config has not answered yet — in which case the form
//         still opens by itself once it does, unless the panel was closed)
const onForm = window.vitrinaChatInstance?.openHomeAction('sell') ?? false;
```

The gate is the **card**, not the Home tab: a tenant whose panel opens straight
into the conversation can still be driven to the intake from their own page.

Consent is recorded, not implied: the intake sends `consent_granted`, the host
page URL (`consent_source_url`) and `consent_text_version: "widget-0.9"`
together, because what matters is which text was shown.

### Fonts

`font` picks the typeface for the entire widget. `system` (the default) loads
**nothing** and uses the native stack. Any other value loads one Google Fonts
stylesheet:

| Value           | Family        |
| --------------- | ------------- |
| `system`        | native stack (default, no request) |
| `dmSans`        | DM Sans       |
| `ibmPlexSans`   | IBM Plex Sans |
| `poppins`       | Poppins       |
| `nunitoSans`    | Nunito Sans   |
| `archivo`       | Archivo       |
| `montserrat`    | Montserrat    |
| `saira`         | Saira         |

**How it works, and why it is not all inside the Shadow DOM.** A shadow root
scopes selectors, but `@font-face` is not a selector — browsers only match
font-face rules declared in the *document's* font source, so a face declared
inside a shadow stylesheet is silently ignored. The widget therefore appends a
single

```html
<link rel="stylesheet" data-vitrina-font="dmSans"
      href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap">
```

to your `<head>` — once per family, idempotent across re-inits and across a
`destroy()`/`init()` cycle — and applies the family *inside* the shadow styles.

**It cannot break your page.** The stack it applies always ends in the same
native fonts the widget has always used, so if the stylesheet is blocked by your
CSP, 404s, or never arrives because the visitor is offline, the widget simply
renders in the fallback stack. Nothing is deferred on the font, and Google's
`display=swap` means text paints immediately either way.

If your site sends a strict Content-Security-Policy and you choose a non-system
font, allow the two Google Fonts origins:

```
style-src  https://api.vitrinadev.com https://fonts.googleapis.com;
font-src   https://fonts.gstatic.com;
```

You do not need either directive when `font` is `system`.

### Where appearance comes from

`locale`, `theme.*`, `logoUrl`, `font`, `bookingLabel`, `welcomeMessage`,
`home`, `help` and `team` are
resolved **server-side** from the dealer's own Vitrina settings and fetched once
at load (`GET /widget/config`).
That is what lets a dealer restyle their bubble from the admin UI and have
already-installed widgets pick it up — within about a minute — instead of asking
every site owner to re-paste a snippet.

Three things worth knowing:

- **Anything you set inline wins.** A widget installed before this existed
  carries a full inline config and therefore renders exactly as it always has.
  Treat inline values as per-site overrides.
- **It fails open.** A network error, an older API without the route, a
  malformed answer — the widget renders with your inline/default theme and
  works normally. The request is never on the critical path.
- **It is cached** in `localStorage` (last known good) and by the browser
  (60s, ETag-revalidated), so repeat visits paint the right colours with no
  network wait. Pass `remoteConfig: false` to opt out of the fetch entirely.

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

## Reliability

Things the widget guarantees, because a dealer's chat failing quietly is worse
than it failing loudly:

- **A visitor's message is never lost.** The optimistic bubble is a real entry in
  the message list, not a DOM artifact, so no repaint can destroy it. A failed
  send leaves it on screen marked *not sent*, with an inline retry that re-uses
  the original client message id — so retrying a message that did land is
  idempotent rather than a double-post.
- **A failed history fetch repaints nothing.** A 500 is distinguishable from an
  empty conversation, so an error can never blank the panel.
- **The connection tells the truth.** Offline, reconnecting, sending and failed
  are separate signals with an explicit precedence, so a successful send can't
  wipe an offline notice that is still true.
- **Nothing thrown reaches the host page.** Every transport method returns a
  typed outcome; `init()` throws only on a missing `publicKey`/`apiBaseUrl`, and
  the `<script>` loader catches even that.

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
