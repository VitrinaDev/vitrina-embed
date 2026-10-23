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

### Option C — combined tag (assistant + Vitrina Ads attribution)

For a tenant with **Vitrina Ads** turned on: one tag boots the assistant
above AND starts Vitrina Ads attribution tracking — no second install. See
**"The combined tag"** below.

```html
<script src="https://api.vitrinadev.com/tag.js?site=pk_live_xxx" async></script>
```

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
  locale: 'es',                    // optional: 'es' | 'en' (the business's language otherwise)
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

## The combined tag (assistant + Vitrina Ads attribution)

`@vitrina/widget/tag` (served at `https://api.vitrinadev.com/tag.js`) is a
**second, separate loader** for dealers who also have **Vitrina Ads** turned
on: ONE `<script>` boots the chat assistant above AND starts Vitrina Ads
attribution tracking, so the click that brought a visitor in is joined to
whatever they do next. The plain `widget.js` loader above is unaffected and
stays the recommended install for a tenant without Vitrina Ads.

There is nothing to configure beyond the site id — no publishable key, no
tracking key, no API base to get right. The tag fetches its own config at
load from Vitrina (`GET /public/sites/{siteId}/tag-config`), so a key
rotation or turning Ads on/off later never means editing this tag again.

Links to the hosted booking page (`https://app.vitrinadev.com/reserva/…`) and a
booking page embedded as an `<iframe>` get `?vt_aid=<anonymous visitor id>`
appended when used, so a booking made there is credited to the ad visit that
led to it. Nothing to set up: the tag learns the booking page's address from
the same config read.

### Direct install

```html
<script src="https://api.vitrinadev.com/tag.js?site=pk_live_xxx" async></script>
```

`pk_live_xxx` is the SAME publishable widget key `window.vitrinaChat.publicKey`
would hold — copy it from **Configuración › Conexiones › Web chat**, same as
for the plain widget.

You can also spell the site id as a `data-site` attribute instead of a query
string:

```html
<script src="https://api.vitrinadev.com/tag.js" data-site="pk_live_xxx" async></script>
```

Both forms work for a direct install. The `?site=` query-string form is the
one that matters for Google Tag Manager, below — GTM strips `data-*`
attributes when it re-creates the tag, so a GTM-installed tag has to carry
its site id in the URL itself. `data-api-base` / `?api=` exist as an escape
hatch that overrides the API host derived from the tag's own origin — you
will not need either on a normal install.

### Google Tag Manager install

For a dealer (or their agency) who installs everything through GTM and never
touches page HTML directly:

1. Open Vitrina → **Configuración › Conexiones › Vitrina Ads** and copy the
   ready-to-paste tag (`GET /api/v1/ads/tracking/installers/gtm?site_id=<pk_…>`
   returns it, already filled in with your site id — the API never asks you
   to build the snippet by hand).
2. In GTM: **Tags › New › Tag Configuration › Custom HTML**, paste the
   snippet verbatim:

   ```html
   <script src="https://api.vitrinadev.com/tag.js?site=pk_live_xxx" async></script>
   ```

3. Trigger: **All Pages**.
4. Name the tag (Vitrina's payload suggests one — e.g. "Vitrina — Asistente +
   Ads (tag único)") and **Publish** the container.
5. Do **not** also install `widget.js`, and do **not** paste the measurement
   provider's own tracker snippet separately — this one tag is both.

Verify it worked with GTM's **Preview** mode: the assistant's launcher bubble
should appear, and a tracker `<script>` from the measurement provider (the
collector your key resolves to) should load in the Network panel
unless the page denies consent (see next section).

### Consent

The **assistant half boots regardless of consent** — talking to a visitor is
not tracking them. The **attribution tracker half loads by default**: a site
in Chile does not need a cookie banner, so with no consent tool installed the
tracker simply runs. It holds back only when the page **explicitly denies**
tracking, through either signal:

- **Google Consent Mode v2** — if your CMP already pushes the standard
  `consent` `default` / `update` entries onto `window.dataLayer`, the tag
  reads them; nothing else to wire up. `ad_storage` or `analytics_storage`
  set to `'denied'` blocks the tracker.
- **`window.__vitrinaConsent`** — a generic hook for a hand-rolled banner or
  a CMP that does not speak Consent Mode: set it to `false` (or a function
  returning `false`) to block, `true` to allow, at any point (before or after
  the tag loads).

  ```html
  <script>
    // e.g. from your own "Rechazar cookies" button:
    window.__vitrinaConsent = false;
  </script>
  ```

The rule, in full:

| Page state | Tracker |
| --- | --- |
| No consent signal at all | loads |
| Consent granted (either signal) | loads |
| Consent explicitly denied | does not load; loads later if it becomes granted |
| `dataLayer` present but no consent default set yet | waits about 1.5 s for one; loads if none is set, stays blocked if a denial arrives |

`__vitrinaConsent` takes priority over Consent Mode when both are present.

### What the combined tag needs from Vitrina

- **#1605** — `GET /api/v1/ads/tracking/key` and `GET /api/v1/ads/tracking/
  installers/gtm` (vitrina-app), admin-scoped, gated behind the Vitrina Ads
  entitlement.
- **#1610** — `GET /api/v1/public/sites/{siteId}/tag-config` (vitrina-app),
  public and unauthenticated — `{siteId}` IS the credential (this package's
  own `pk_…`). Answers `{ assistant, tracking }`; `tracking` is `null` for a
  tenant without the Ads entitlement, and the assistant still boots.

---

## Configuration options

| Option           | Type                          | Required | Default            | Description                                                                 |
| ---------------- | ----------------------------- | -------- | ------------------ | --------------------------------------------------------------------------- |
| `publicKey`      | `string`                      | **yes**  | —                  | Publishable widget key (`pk_…`), origin-locked. Safe to ship in page source. |
| `apiBaseUrl`     | `string`                      | **yes**  | —                  | Vitrina API base, e.g. `https://<host>/api/v1`. Trailing slash is trimmed.  |
| `vehicleId`      | `string`                      | no       | `null`             | Pre-attach the inquiry to a vehicle (the `id` from `/stock`).               |
| `vehicleLabel`   | `string`                      | no       | `null`             | Display title for `vehicleId`, e.g. `Toyota Yaris 2021`. Shown on the booking summary only when BOTH are set. |
| `locale`         | `'es' \| 'en'`                | no       | the business's     | Widget chrome language. Unset = the business's language from Vitrina; the visitor's browser decides only when the business offers several languages. Falls back to `es`. |
| `theme.accent`   | `string` (CSS color)          | no       | `#111827`          | Brand accent for the launcher + inbound bubbles. Sanitized; bad values fall back. |
| `theme.position` | `'br' \| 'bl'`                | no       | `'br'`             | Launcher corner: bottom-right or bottom-left.                               |
| `theme.logoUrl`  | `string` (http/https URL)     | no       | —                  | Older spelling of `logoUrl` below. Still honoured; the top-level one wins.  |
| `logoUrl`        | `string` (http/https URL)     | no       | —                  | Logo in the panel header, ~22px tall, never cropped. Non-http(s) URLs are ignored — no logo, never a broken image. |
| `logoOnDarkUrl`  | `string` (http/https URL)     | no       | —                  | Logo variant for dark grounds (also `theme.logoOnDarkUrl`). Drawn instead of `logoUrl` on the accent header, and on the surface headers under `prefers-color-scheme: dark`. CSS picks the variant. Unset ⇒ `logoUrl` everywhere. |
| `font`           | `WidgetFont`                  | no       | `'system'`         | Typeface for the whole widget. See **Fonts** below. Unknown values fall back to `system`. |
| `bookingLabel`   | `string`                      | no       | localized copy     | What the booking chip says, verbatim — e.g. `Agendar demo`. Trimmed; blank or over 40 chars falls back to the built-in copy. Only visible when the tenant has booking on. |
| `welcomeMessage` | `string`                      | no       | localized greeting | Greeting shown before the visitor sends the first message.                  |
| `home`           | `{ enabled?, title?, subtitle?, cards?, prompts? }` | no | off          | The Home tab. See **Home and Help tabs** below. Off unless `enabled` is `true`. |
| `home.cards`     | `{ buy?, sell?, search? }`    | no       | all off            | The automotive quick actions. See **Quick actions** below. Each card is off unless its key is explicitly `true`. |
| `home.prompts`   | `('properties' \| 'visit' \| 'list_property' \| 'products' \| 'order_status' \| 'projects' \| 'showroom_visit' \| 'after_sales')[]` | no | none | Prompt cards (real estate, store), in order. See **Prompt cards** below. Unknown ids and repeats are dropped. |
| `home.productsUrl` | `string` (http(s) URL) | no | none | The store's catalog page. The `products` card opens it instead of sending a message (0.23.5). See **Prompt cards** below. |
| `help`           | `{ enabled?, faqs? }`         | no       | off                | The Help tab (FAQ accordion). Off unless `enabled` is `true` **and** at least one usable question survives. |
| `team`           | `Array<{ name, avatarUrl? }>` | no       | `[]`               | Faces for the Home hero. Up to 5 accepted, first 3 drawn. Non-http(s) `avatarUrl` ⇒ initials. |
| `remoteConfig`   | `boolean`                     | no       | `true`             | Fetch appearance from Vitrina at load. `false` = fully self-contained.      |
| `layout`         | `'bubble' \| 'sidebar' \| 'inline'` | no | `'bubble'`      | Placement. See **Sidebar mode** below. |
| `preset`         | `'default' \| 'cream'`        | no       | `'default'`        | Surface palette. `cream` = the Vitrina landing tokens, DM Sans, ember `#AD4E00`. |
| `agent`          | `{ name, label, status?, avatarUrl?, avatar? }` | no | none | The named assistant. Needs BOTH `name` and `label` (the AI disclosure) or it is ignored. `avatar: 'mark'` draws the Vitrina brand mark instead of a portrait (see **Sidebar mode**). |
| `chips`          | `Array<{ label, message?, action? }>` | no | `[]`           | Up to 4 suggested questions. `action`: `message` (default), `demo`, `booking`. |
| `autoOpen`       | `WidgetAutoOpenConfig`        | no       | off                | Proactive open. See **Auto-open** below. |
| `whatsapp`       | `{ number, text? }`           | no       | none               | One-tap continuation on WhatsApp with the conversation's reference code. |
| `cta`            | `{ label }`                   | no       | none               | Full-width pinned button above the composer (sidebar/inline). |
| `demoWorld`      | `string`                      | no       | none               | Name of the fictional business demo mode plays, e.g. `Automotora Demo`. |
| `demoKind`       | `'automotora' \| 'clinica'`    | no       | read off `demoWorld` | Which world the server plays (`demo_world` on each demo message). |
| `pageContext`    | `Record<string, string>`      | no       | `{}`               | Page facts sent with each message (`page_context`), ≤ 8 snake_case keys. |
| `pricePolicy`    | `{ mode: 'first_ask' \| 'evaluation_only' \| 'never' \| 'script'; script?: string }` | no | none | How the assistant answers price questions; sent as `price_policy` with each message (the server honours it only on the demo clinic's key). Unknown `mode` or `script` without text is dropped; `script` is trimmed and cut to 400 chars. Inline only. |
| `freshConversation` | `boolean`                  | no       | `false`            | Forget this key's stored visitor at init so a NEW conversation starts with no history. Restart a chat with `destroy()` + `init({ ...same, freshConversation: true })`. |
| `launcherStyle`  | `'tab' \| 'bubble' \| 'sidetab'` | no | `'tab'` | Sidebar mode, desktop launcher. `sidetab` (0.18.0): a vertical rectangle on the right-centre edge with the portrait and a chat icon, no text; the ask is a tooltip and the aria-label (which carries the AI label). |
| `typingOnSend`   | `boolean`                  | no       | `false`            | Show the typing dots from the accepted send until a reply lands; «Sigue escribiendo…» after 12 s, gone after 60 s. Off by default: where a person answers later, dots would promise a reply that is not coming. |
| `showPoweredBy`  | `boolean`                  | no       | `true`             | The small «Con tecnología de Vitrina» credit under the composer (a followed link to vitrinadev.com, inside the widget's open shadow root, so it is part of the host page's DOM). `false` removes it. |
| `autoOpen.requireScroll` | `boolean \| { px?: number; viewport?: number }` | no | off | Auto-open only after the visitor scrolled at least `px` pixels or `viewport` window heights (`true` = half a window), once since load. A visitor who stays on the first screen never gets it. |
| `chips[].reply` / `chips[].next` | `string` / `WidgetChipConfig[]` | no | none | Scripted chips (0.18.0): answered in the browser after a 600–900 ms typing beat, with `next` chips under the reply (up to 3 scripted replies in a row, 4 chips each). No server call. The taps ride the next typed message as `page_context.chips_seen`. `action: 'link'` + `url` navigates; `action: 'compose'` focuses the composer. |
| `anchor`         | `'auto' \| 'bottom-bar'`      | no       | `'auto'`           | `bottom-bar`: on phones the launcher renders inside `launcherSlot`. |
| `launcherSlot`   | `HTMLElement \| string`       | no       | —                  | Element or selector for the bottom-bar launcher. |
| `container`      | `HTMLElement \| string`       | no       | —                  | Element or selector for `layout: 'inline'`. Missing ⇒ sidebar. |

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

### Clinics: the clinic booking flow

When the Vitrina workspace is a clinic with an active online-booking landing,
`GET /widget/config` answers `clinicBooking: { enabled: true }` and the chip
("Reservar hora" by default) opens the clinic flow instead:
`servicio → profesional (o cualquiera) → fecha → hora → datos → resumen → listo`.
Services, prices, deposits, professionals and branding come from the landing,
hours from the clinic's Vitrina agenda, and the booking goes through the same
service as the hosted booking page, so the cita, the contact and the deposit
hold are identical whichever one the patient used.

The booking carries the ad click: UTMs and `fbclid`/`gclid` from the URL the
patient landed on (remembered for the tab, so booking from another page still
counts) and the Vitrina tag's anonymous visitor id. No page URL, referrer or
title is ever sent, and the widget loads no ad-platform tag.

A clinic with several landings picks one with `landing`:

```js
window.vitrinaChat = { publicKey: 'pk_…', apiBaseUrl: '…', landing: 'convenio-isapre' };
```

The confirmation shows the code and where the booking stands. For a service
with a deposit it shows the amount, the deadline and — when the clinic connected
its Mercado Pago — a «Pagar con Mercado Pago» button for that booking's own
checkout (new tab). The screen re-reads the booking while it is open and flips
to «Confirmada» once the payment lands. «Cambiar hora» and «Cancelar hora» run
right there, through the booking's manage token.

**Abandoned bookings.** The details step has an unchecked box: «Quiero recibir
mensajes por WhatsApp sobre esta reserva». Once a phone is typed, the widget
saves a booking draft (what was picked, the box, the ad click and this page's
URL). A patient who ticked it and left gets one WhatsApp from the clinic whose
link comes back to this same page with `?vt_draft=…`; the widget opens itself
at the draft, details filled in (or at that day's hours, if the hour went), and
the booking completes the draft. The page must be on an origin the key allows.

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

### Prompt cards — ver propiedades, agendar una visita, publicar mi propiedad, ver productos, estado de mi pedido

One-tap conversation starters for real-estate workspaces (0.21.0) and stores (0.22.0). Each card
opens Mensajes and sends a fixed visitor message through the composer's own
send path (same honeypot, consent and Turnstile gates, same `message` event):

```json
{ "home": { "enabled": true, "prompts": ["properties", "visit", "list_property"] } }
```

| id              | Card (es)               | Message sent (es)              | Message sent (en)              |
| --------------- | ----------------------- | ------------------------------ | ------------------------------ |
| `properties`    | Ver propiedades         | «Quiero ver propiedades»       | "I'd like to see properties"   |
| `visit`         | Agendar una visita      | «Quiero agendar una visita»    | "I'd like to book a visit"     |
| `list_property` | Publicar mi propiedad   | «Quiero publicar mi propiedad» | "I'd like to list my property" |
| `products`      | Ver productos           | «Quiero ver productos»         | "I'd like to see products"     |
| `order_status`  | Estado de mi pedido     | «¿Cuál es el estado de mi pedido?» | "What's the status of my order?" |
| `projects`      | Ver proyectos           | «Quiero ver los proyectos»     | "I'd like to see the developments" |
| `showroom_visit`| Agendar visita a sala   | «Quiero agendar una visita a la sala de ventas» | "I'd like to book a visit to the sales showroom" |
| `after_sales`   | Post-venta              | «Tengo una consulta de post-venta» | "I have an after-sales question" |

`projects`, `showroom_visit` and `after_sales` (0.24.0) are the inmobiliaria's set; the server sends
them for tenants running Módulo Proyectos.

They paint in the given order, after the chat and booking cards and before the
automotive quick actions. The server sends `home.prompts` only when at least one
is on; an inline `home.prompts` replaces the server's list wholesale (it is an
array, like `team`). A config refresh repaints them in both directions.

**«Ver productos» as a link (0.23.5).** With `home.productsUrl` set (the server
sends it from the tenant's «Link del catálogo», `webchat.products_url`), the
`products` card opens that page instead of sending «Quiero ver productos». Its
subline becomes «Mira el catálogo completo». A URL on the host page's own origin
opens in the same tab and closes the panel (the visitor is already on the
store); any other origin opens in a new tab. Without the field the card sends
its message, as before.

```json
{ "home": { "enabled": true, "prompts": ["products", "order_status"], "productsUrl": "https://macphones.cl/iphone" } }
```

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

### Sidebar mode

`layout: 'sidebar'` turns the floating bubble into a right-docked assistant:

- **Desktop:** a 400 px panel that overlays the page (it never pushes the
  layout) and collapses to a side tab with the assistant's portrait.
- **Phones (≤ 768 px):** the panel only goes full screen when the visitor taps.
  Auto-open shows a **peek card** instead (greeting in two lines, the chips, a ×),
  and the card hides while any field on the page has focus or the keyboard is
  open, then comes back.
- **Disclosure:** the portrait is always shown with `agent.label` beside it;
  below 40 px (side tab, launcher, peek card) it carries an «IA» badge. With no
  `agent.avatarUrl` a neutral silhouette is drawn. Under 40 px the portrait is exposed as an image named `<name>, <label in lower case>` (Ámbar: «Ámbar, asistente IA de Vitrina»).
- **Brand mark (`agent.avatar: 'mark'`, 0.23.0):** instead of a face, the
  Vitrina mark (an isometric pyramid of two hairline rings with the amber core
  on top) on a hairline tile in the preset's colours, everywhere the portrait
  appears (header, side tab, bubble, peek card, bottom-bar slot). It carries no
  presence dot and no «IA» badge, since it is plainly not a person; it is always
  exposed as an image named `<name>, <label in lower case>`, and the header's
  visible label stays. While the assistant is typing the core bobs gently (none
  under `prefers-reduced-motion`). It wins over `avatarUrl`; without it the
  portrait behaves exactly as before.
- **`anchor: 'bottom-bar'`:** a page with its own sticky bar gives the widget a
  slot (`launcherSlot`). The launcher renders there on phones, and the peek card
  sits above the bar (mark the bar `data-vtr-bar`).
- **`layout: 'inline'`:** the same chat inside `container`, already open.

```html
<script>
  window.vitrinaChat = {
    publicKey: 'pk_live_xxx',
    apiBaseUrl: 'https://api.vitrinadev.com/api/v1',
    layout: 'sidebar', preset: 'cream', anchor: 'bottom-bar', launcherSlot: '#ambar-slot',
    agent: { name: 'Ámbar', label: 'Asistente IA de Vitrina', status: 'Responde al instante', avatar: 'mark' },
    welcomeMessage: '¡Hola! Soy Ámbar, la asistente IA de Vitrina. ¿En qué te ayudo?',
    chips: [{ label: '¿Cuánto cuesta?' }, { label: 'Pruébalo', action: 'demo' }],
    whatsapp: { number: '+56 9 XXXX XXXX', text: 'Hola Ámbar, sigo la conversación de la web (ref {ref})' },
    cta: { label: 'Agendar demo' },
    autoOpen: { enabled: true, delaySeconds: 10, excludePaths: ['/agendar/*'] },
  };
</script>
```

Layout and chrome are decided once, at load, from the inline config plus the
last cached server answer. A server-side change to them applies from the next
pageview, never by re-mounting a widget the visitor may be typing into.

### Auto-open

`autoOpen: { enabled, delaySeconds = 10, mobileDelaySeconds, desktop = 'panel' | 'teaser' | 'off', mobile = 'teaser' | 'off', excludePaths, variant }`

- Counts from page load, so a lazily loaded widget opens on time.
- Once per browser session: never again after it fired, after the visitor
  opened the widget themselves, or after any dismiss.
- Never over a busy page. When it is due while a field is focused, a video with
  sound plays, or a `<dialog open>` / `[aria-modal="true"]` / `[data-vtr-busy]`
  element is on the page (mark your booking sheet), it waits for the page to be
  quiet and gives up after 60 s.
- A phone never gets the full panel on its own; `mobile: 'panel'` is read as
  `teaser`.
- `variant` is echoed on the `autoopen` event, for experiments.

### The JavaScript API and events

`init()` (or `window.vitrinaChatApi` with the loader) returns:
`open()`, `close()`, `hide()`, `show()`, `prefill(text)`, `send(text)`, `enterDemo()`, `exitDemo()`,
`openBooking()`, `openHomeAction(kind)`, `setVehicle(id, label)`,
`whatsappUrl()`, `on(event, handler)` (returns the unsubscribe) and `destroy()`.

Events: `open {source}`, `close {source}`, `hide {}`, `show {restored}`, `autoopen {mode, device, variant}`,
`dismiss {surface}`, `chip {index, label, action}`, `message {clientMessageId}`,
`handoff_whatsapp {ref}`, `demo_enter {entry, world}`, `demo_turn {turns}`, `demo_exit {reason, turns}`, and
`cta {source}`. The pinned CTA (and a `booking` chip) opens the in-widget agenda
when the tenant has it on; otherwise it only emits `cta`, and the host opens
its own booking sheet.

Demo mode (D60) frames the panel («Modo demo», the `demoWorld` mark, tinted
replies, «Salir del modo demo») and sends `mode: 'demo'` with each message.

### WhatsApp continuation

The link is a plain `wa.me` anchor (no `window.open`, so in-app browsers allow
it): `https://wa.me/<number>?text=<text with (ref XXXXXX)>`. The reference is
derived from the web conversation's external id: FNV-1a 32-bit over its UTF-8
bytes, top 30 bits as 6 Crockford base32 characters (`0-9A-HJKMNP-TV-Z`).
vitrina-app recomputes it to join the WhatsApp thread to the web one. Before
the first message there is no conversation, so the text carries no ref.

### Loading it lazily (`boot.global.js`)

A page that guards its LCP loads the 1 KB boot stub instead of the widget:

```html
<script src="https://cdn.jsdelivr.net/npm/@vitrina/widget@0.17.0/dist/boot.global.js"
        data-src="https://api.vitrinadev.com/widget.js" async></script>
```

It injects `widget.js` on the first interaction, at idle + 4 s, shortly before
the auto-open timer, or on the first API call. Until then
`window.vitrinaChatApi` queues calls. Code that runs before the stub can queue
directly: `(window.vitrinaChatQueue ||= []).push(['on', ['cta', openSheet]])`.
`pnpm --filter @vitrina/widget size` prints the gzip report against budgets.

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
pnpm build       # tsup → dist/ (ESM library + IIFE loader + IIFE combined tag + .d.ts)
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest (happy-dom)
```
