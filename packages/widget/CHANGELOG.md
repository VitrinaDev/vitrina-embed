# @vitrina/widget

## 0.9.1

Home header redesign (founder feedback): the accent gradient hero is gone.
The brand accent is now a slim 5px top line on the panel (tabs mode); the
Home header sits on the surface with regular text colors and a hairline
under it, and the cards flow below instead of floating over a fade.

## 0.9.0

Three automotive quick actions on the Home screen — **comprar un auto**,
**vender tu auto** and **lo buscamos por ti** — each a card that opens a short
form inside the panel, and each off unless the tenant turns it on.

### Nothing changes for a tenant with no cards

The load-bearing property, again. With no `home.cards`, `setHomeCards` builds
nothing: no card, no `.vtr-ha` overlay, no `data-home-action`, and
`resolveConfig().home` resolves to the same three-key object 0.8.x resolved to.
A tenant with Home off and no cards gets `header → messages → typing → banner →
composer → footer`, node for node, and the suite asserts that list.

`openBooking()`, `bookingLabel` and the tabs keep their semantics exactly.

### `home.cards` — the config surface

```json
{ "home": { "enabled": true, "cards": { "buy": true, "sell": true, "search": true } } }
```

Opt-IN per card: only an explicit `true` counts, and the bag merges FIELD-WISE
under an inline `home.cards`, so a page can force one card on and still let
Vitrina decide the other two. Which cards a vertical turns on by default is the
server's decision — the widget renders what resolves.

### Two destinations, deliberately different

**Buy** and **search** are one screen each (nombre · teléfono · email? · what
you are after · presupuesto · consent) and they are **messages**: the form
composes one, sends it down the ordinary pipeline with the visitor's name,
phone and email attached, and then gets out of the way — the overlay closes,
Mensajes opens, and the reply arrives in the thread the visitor is already
looking at. There is no second success screen, because the conversation is the
confirmation. A send that cannot start keeps the form and every word in it.

**Sell** is an **intake**, four steps — *Tu auto* (patente, marca, modelo, año,
kilómetros) → *Detalles* (versión?, precio esperado?, plazo de venta, región,
comentarios?) → *Fotos* (optional and skippable, ≤8 files, ≤10 MB each,
client-validated with the rejected one named rather than silently dropped) →
*Tus datos* (nombre, teléfono o email, consent) — posting `multipart/form-data`
to `POST /widget/consignments` with the photos under a repeated `fotos` field.
`201 received` and `200 duplicate` are the SAME success screen: the dealer
already having the car is our bookkeeping, not the visitor's problem. A 415
names the photos; anything else is a plain retry with the form intact.

Numbers are read the way Chileans type them — `42.000` and `$8.500.000` reach
the wire as `42000` and `8500000` — and the patente is upper-cased so `bcdf12`
and `BCDF12` are one car on the ledger.

### `openHomeAction(kind)` — for a page that already has the button

```js
// true  → the visitor is looking at that form
// false → they got the conversation panel instead (that card is off, or
//         GET /widget/config has not answered yet — in which case the form
//         still opens by itself once it does, unless the panel was closed)
const onForm = window.vitrinaChatInstance?.openHomeAction('sell') ?? false;
```

Same contract as `openBooking()`, deferred intent included, so a storefront
hero's "Vende tu auto" is one call rather than a second implementation of the
form. The gate is the CARD, not the Home tab: a tenant whose panel opens
straight into the conversation can still be driven to the intake.

### Consent, recorded rather than implied

The consignment intake sends the consent trio together — `consent_granted`,
`consent_source_url` (the host page, ≤2048 chars) and
`consent_text_version: "widget-0.9"` — because Ley 21.719 asks WHICH text was
shown, not merely that a box was ticked. The version string changes when the
copy does, and never otherwise.

### Also

- New i18n copy in both locales (parity test still exhaustive), a honeypot in
  the overlay chrome so all three forms carry `hp_website`, and three new
  stroked glyphs (car, price tag, magnifier).
- `submitConsignment()` on the transport: the package's first multipart call —
  the browser sets `Content-Type` and its boundary, and we send only
  `Authorization` plus the usual `?siteKey=`.
- No Turnstile client code, matching the booking precedent (see the PR notes).

## 0.8.2

The header title ("Conversemos") is now absolutely centered in both header
shapes — the legacy accent band and the compact tabs/help headers — instead of
sitting left of center next to the logo. Long titles ellipsize at 55% of the
header width; the close button keeps its right edge via margin-left:auto.

## 0.8.1

Spacing fix: the entry-chip row (`.vtr-actions`, e.g. "Agendar visita" /
"Agendar demo") now carries 10px bottom padding — it used to sit directly on
the composer's top border with zero separation.

## 0.8.0

The panel can be more than a transcript: an Intercom-style **Home** screen and a
**Help** FAQ, both server-driven, both off by default.

### Nothing changes for a tenant who configures nothing

This is the load-bearing property of the release. With no `home` and no `help`,
`ensureViews()` is never reached — there is no `.vtr-views` wrapper, no
`.vtr-tabs` node, no `data-tabs` and no `data-active-view` on the panel, and the
header keeps its accent band. The panel's children are still
`header → messages → typing → banner → composer → footer`, node for node, and
the test suite asserts that exact list so a future wrapper breaks a test rather
than a dealer's site.

`openBooking()` keeps its semantics exactly, including the pending-open path.

### `home` — a landing screen in front of the conversation

```json
{ "home": { "enabled": true, "title": "¡Hola! 👋", "subtitle": "¿Cómo te podemos ayudar?" } }
```

A hero in the tenant's accent — logo, an overlapping stack of up to three faces
from `team`, greeting — with cards floating over its fade:

- **the last message**, one line, markdown stripped, only when there is a
  conversation to come back to;
- **"Envíanos un mensaje"**, always, because that is what the widget is for;
- **the booking card**, only for a tenant whose agenda is on, titled with their
  `bookingLabel` and never with our copy, opening the same overlay by the same
  gated path as the chip.

`title` and `subtitle` are optional and fall back to localized defaults.

### `help` — an FAQ accordion, and one way out

```json
{ "help": { "enabled": true, "faqs": [{ "q": "¿Cómo agendo?", "a": "Desde **Agendar visita**." }] } }
```

Answers are markdown, rendered through the same node-building renderer as every
agent reply — a pasted `<img onerror=…>` is text, in every path, because nothing
in this package parses HTML. Several answers can stand open at once. One sticky
button at the bottom drops the visitor into the composer.

Enabled means the flag AND at least one usable question: a Help tab that opens
onto nothing is worse than no Help tab, so it is re-derived client-side after
the sanitizers have run.

### `team` — faces on the hero

```json
{ "team": [{ "name": "María Fernández", "avatarUrl": "https://cdn.dealer.cl/maria.jpg" }] }
```

Up to five accepted, the first three drawn. An `avatarUrl` that is not an
absolute http(s) URL becomes the member's initials on a colour picked by hashing
their name — stable across every repaint, and never a broken image.

### Layering and failure modes

`home` and `help` merge FIELD-WISE under the inline config, like `theme`: an
inline `home.title` beats the server's while the server's `home.enabled` still
decides whether the tab exists. `team` replaces the server's list wholesale.

Every cap fails per-item rather than all-or-nothing: `title` ≤ 80,
`subtitle` ≤ 120, ≤ 20 FAQs (`q` ≤ 200, `a` ≤ 2000), ≤ 5 team members
(`name` ≤ 40). A malformed FAQ entry drops itself and the rest still render; an
over-long title falls back to the default rather than being cut mid-sentence.
The sanitizers run on the wire AND in `resolveConfig`, so a tampered
last-known-good cache cannot smuggle an unvalidated value into the panel.

### Where the visitor lands

Home, unless replies were waiting behind a closed panel — then Messages. The
host marks the conversation read immediately before opening, so the unread
count always reads zero by then; the widget remembers the fact separately.

### Panel size

400×704 (from 360×520), with or without the tabs. The old card was sized for a
transcript and nothing else. Still `max-width: calc(100vw - 40px)`, still
fullscreen at ≤480px.

## 0.7.0

The widget wears the tenant's brand: their word for the booking flow, their
typeface, their logo.

### `bookingLabel` — the chip says what the tenant configured

```js
window.vitrinaChat = { /* … */ bookingLabel: 'Agendar demo' };
```

Used **verbatim**, in whatever language it is written in — it is the dealer's
own word for their flow, not a translation key, so a chrome-language change
leaves it alone. Trimmed; blank or over 40 characters falls back to the built-in
"Agendar visita" / "Book a visit". Resolved from `GET /widget/config` too, so it
is set in Vitrina and reaches installed widgets without anyone editing a page.

Because the chip can now say "Agendar demo", the rest of the flow may no longer
insist on a *visita*. Every string that would have contradicted a custom label is
now neutral — see **Copy** below. The default chip copy is unchanged.

### `font` — DM Sans and six more, or the native stack

```js
window.vitrinaChat = { /* … */ font: 'dmSans' };
```

`'system'` (the default) loads nothing and renders exactly as before. The other
values — `dmSans`, `ibmPlexSans`, `poppins`, `nunitoSans`, `archivo`,
`montserrat`, `saira` — load one Google Fonts stylesheet each.

The mechanics matter on a third-party site. `@font-face` is not a selector, and
browsers only match font-face rules declared in the **document's** font source —
a face declared inside a shadow root is silently ignored. So the widget appends
one `<link rel="stylesheet" data-vitrina-font="…">` to the host page's `<head>`
(idempotent per family, across re-inits and across a `destroy()`/`init()` cycle)
and applies the family *inside* the shadow styles, over a fallback stack that
ends in the fonts the widget has always used.

Nothing about the widget is deferred on that stylesheet. A dealer CSP that
blocks it, a 404, an offline visitor: the text renders in the fallback stack and
everything else behaves identically. Sites with a strict CSP that choose a
non-system font need `style-src https://fonts.googleapis.com` and `font-src
https://fonts.gstatic.com` — and need neither when `font` is `system`.

### `logoUrl` — the tenant's mark in the panel header

Top-level now (`logoUrl`), matching the shape `GET /widget/config` sends. The
older `theme.logoUrl` still works; the top-level one wins when both are set, and
inline still beats the server in either spelling.

The header logo is also **no longer cropped**: it was a 28×28 `object-fit: cover`
square, which turned every wide dealer wordmark into its middle third. It is now
sized by height (22px, `object-fit: contain`, max 108px wide), so a wordmark
reads. A missing, blank or non-http(s) URL means no logo at all — never a broken
image, never an empty box.

### Copy

Neutral wording for the strings that would have contradicted a custom booking
label. Only these changed:

| Key                | es (was → now)                                    | en (was → now)                                    |
| ------------------ | ------------------------------------------------- | ------------------------------------------------- |
| `myVisits`         | Mis visitas → **Mis reservas**                     | My visits → **My bookings**                        |
| `stepDoneTitle`    | Visita agendada → **Reserva confirmada**           | Visit booked → **Booking confirmed**               |
| `cancelTitle`      | Cancelar visita → **Cancelar reserva**             | Cancel visit → **Cancel booking**                  |
| `cancelledTitle`   | Visita cancelada → **Reserva cancelada**           | Visit cancelled → **Booking cancelled**            |
| `confirmCta`       | Confirmar visita → **Confirmar reserva**           | Confirm visit → **Confirm booking**                |
| `cancelVisitCta`   | Cancelar visita → **Cancelar reserva**             | Cancel visit → **Cancel booking**                  |
| `keepVisitCta`     | Mantener la visita → **Mantener la reserva**       | Keep the visit → **Keep the booking**              |
| `noVisits`         | …no tienes visitas agendadas → **…no tienes reservas agendadas** | You have no booked visits yet → **You have no bookings yet** |
| `consentLabel`     | …coordinar esta visita → **…coordinar esta reserva** | …arrange this visit → **…arrange this booking**   |
| `privacyNote`      | …coordinar la visita → **…coordinar la reserva**   | …arrange the visit → **…arrange the booking**      |
| `writeUsDraft`     | …agendar una visita… → **…reservar una hora…**     | …book a visit… → **…book a time…**                 |
| `otherDeviceDraft` | …reservé una visita… → **…reservé una hora…**      | …booked a visit… → **…booked a time…**             |

`bookVisit` ("Agendar visita" / "Book a visit") is unchanged — it is the default
the tenant label replaces.

### Notes

Purely additive on the config surface: every widget installed today renders
byte-identically, because `font` defaults to `system` and the other two default
to the behaviour they already had. The inline-wins precedence is the same one
`theme` / `locale` / `welcomeMessage` have always followed, and all three new
fields count as pinned appearance — a page that sets one is never held back
waiting for `GET /widget/config`.

## 0.6.0

The host page can open the agenda itself.

### `openBooking()` on the public handle

A site that already shows the ask — a dealer's "Agendar visita" button, a
landing page's "Agendar demo" — no longer has to answer that click with a chat
panel and leave the visitor hunting for the chip:

```js
// true  → the visitor is looking at the calendar
// false → they got the conversation panel instead
const onCalendar = window.vitrinaChatInstance?.openBooking() ?? false;
```

The panel opens in every case, because the conversation is the honest fallback
whenever the agenda cannot appear — so `false` is a fallback, never a failure.
It means one of two things: this tenant has booking off, or `GET /widget/config`
has not answered yet. The second is **held, not dropped** — the calendar opens
by itself the moment the gate answers yes, unless the visitor closed the panel
first, since an overlay must never appear under the cursor of someone who
walked away.

Purely additive: `init()` returns the same handle it always did, plus this. A
tenant without the agenda still constructs no booking node at all.

### Fixed

- The booking suite's fixture pinned day 12 of the current month, so from the
  12th onward it booked a visit in the PAST and the "Mis visitas" badge
  assertion failed — a red suite that had nothing to do with the widget. Every
  date is now computed from `now`, month boundaries included.

## 0.4.0

A visitor can book a visit without writing a single message.

### Booking, inside the chat (S15-21)

When the dealer switches on **Agendar visita** (Configuración › Conexiones ›
Web chat), a chip appears over the composer: fecha → hora → datos → resumen →
confirmación, against the dealership's real calendar (`/widget/appointments*`,
the same ledger the team and the AI book into). Days without hours are dimmed,
month navigation stops at the tenant's real booking horizon and says so, and a
taken hour is shown greyed rather than hidden — the agenda looks real because
it is. The confirmation hands the visitor a reservation code (`A-n`, the same
folio the dealer sees) and "Mis visitas" lets the same browser review and
cancel it — the management token never leaves localStorage and is a
capability, so it is never rendered or logged.

**Consent is required and recorded.** The form does not submit without the
checkbox, and the booking carries the timestamped consent.

**The race is handled honestly.** If the hour (or the car) is taken while the
visitor types, the widget says which of the two happened, refreshes the grid,
and keeps everything they wrote.

**Tenant off = byte-identical widget.** Without `booking_enabled` there is no
chip, no tab, no card — nothing to discover.

### Mobile, finally full-screen

Under 480px the panel is now a full-screen sheet (`100dvh`) instead of a
desktop card floating on a phone. This applies to chat too, booking or not.

### Notes

- Requires vitrina-app ≥ the S15-21/BE-C API for the full experience
  (horizon, dimmed hours, per-reason refusals); against an older API the flow
  still completes with an available-only grid and generic copy.
- Bundle: 11.4 → 23.3 KB gzipped (the flow, its strings and its styles).

## 0.3.0

The widget asks Vitrina what it should look like.

### Appearance can finally change after install

Until now the only way to theme the widget was the `window.vitrinaChat` object
pasted into the dealer's HTML. Changing the bubble's colour meant asking every
dealer to edit their own site — so in practice nobody's widget ever changed, and
the appearance a dealer picked on install day was the appearance they had
forever.

`init()` now fetches `GET /widget/config`, which resolves colour, corner, logo,
greeting and language from the dealer's own Vitrina settings. A dealer restyles
their bubble in **Configuración › Conexiones › Web chat** and every installed
copy picks it up within about a minute. The install snippet is down to
`publicKey` + `apiBaseUrl`.

**Anything set inline still wins.** That is deliberate and it is what makes this
a non-event for existing sites: every widget installed before 0.3.0 carries a
fully-populated inline config, so none of them change by a pixel. An inline
value is now a per-site override rather than the only way to set anything.

**It fails open.** A network error, an older API with no such route, a malformed
answer — the widget renders with the inline/default theme and works normally. A
dealer's chat must never be worse off for our having asked a cosmetic question.

**It does not flash.** The last good answer is cached in `localStorage`, so a
repeat visitor's first paint is already correct with no network wait. Only a
first-ever visit to a site that pinned nothing inline can be blind, and there the
launcher is held back until the answer lands — for at most 1.2s, on a timer that
runs regardless of the network, so a hung request can never leave a dealer's site
without a chat button.

Opt out entirely with `remoteConfig: false`.

### Other

- The panel header's logo element is now always present (hidden, `src`-less)
  rather than conditionally inserted, so a logo arriving with the served config
  lands in the right slot without re-ordering the header.
- A `br` → `bl` change now clears the old side on the light-DOM host element.
  Leaving `right: 0 !important` behind while adding `left: 0` would have
  stretched the host across the viewport and swallowed clicks on the page under
  it.

## 0.2.0

The reliability floor. Everything below is either a bug a visitor could see, or
a promise the platform was already making and not keeping.

### A visitor's message is never lost

A visitor typed a message, the post-send refetch failed, and their own text
vanished off the screen while the widget said "sent". Two defects combined:

- the optimistic bubble was a DOM-only artifact, destroyed by any repaint — and
  a repaint follows every send;
- `fetchHistory` returned `[]` on **every** failure, so a 500 was
  indistinguishable from an empty conversation.

Both are fixed at the root. The echo is now a real entry in the message list
with a `pending` / `failed` status, so it survives repaints by construction. A
failed history fetch repaints nothing. A failed send renders an inline retry
that re-sends with the original client message id, so retrying a message that
did in fact land is idempotent.

### The AI's markdown actually renders

The platform told the model that markdown renders and links are clickable. The
widget painted every reply with `textContent`, so the first reply a visitor read
after a dealer enabled the AI would have contained literal asterisks.

A deliberately small subset now renders — bold, italic, inline code, links,
bullet and numbered lists, newlines — built from DOM nodes. No markdown library
and no `innerHTML`: an injected tag is a text node on every path, because no
path parses HTML. Link hrefs are http/https only and open with
`rel="noopener noreferrer"`.

### Reconnection is visible

The transport always knew it was reconnecting — backoff with jitter, re-mint on
401, longer backoff on rate limiting — and never told anyone. It does now, on
change only, so the banner cannot flap. A 401 that re-mints successfully stays
silent, because nothing was wrong from the visitor's point of view.

### A closed panel badges its unread replies

A reply arriving while the panel is shut increments a count on the launcher.
Opening clears it. No sound, no browser notification, no favicon dot, no title
flashing: a count is a signal, the rest is an interruption on someone else's
website.

### Also

- A typing indicator, shown when either the AI or a person begins composing.
  The visitor is never told which — deliberately. It clears when a reply arrives
  or when the event's TTL elapses, so a producer that crashes cannot leave a
  permanent lie on screen.
- A single anonymous line when a person joins the conversation. It names nobody.
- Vehicle cards: a photo, title, price and link, beneath the AI's reply rather
  than instead of it. A widget that does not recognise the message type renders
  the prose, so this degrades rather than breaking.
- Unrecognised realtime event types are ignored, and can never advance the
  history cursor. This is what lets the server ship new events without waiting
  for dealers to upgrade a script tag.
- `https://api.vitrinadev.com/widget.js` now serves the loader, so a dealer's
  Content-Security-Policy needs exactly one Vitrina origin.

### Breaking (internal only — `init()` is unchanged)

- `fetchHistory` returns a discriminated `HistoryOutcome` instead of a bare
  array.
- `openStream` takes a handlers object instead of a bare callback.
- `WidgetUi.appendOptimistic` is gone. A local echo is a message, not a DOM node.

Requires an API that projects `clientMessageId` on inbound rows (vitrina-app
≥ 2.5.0).

## 0.1.1

Send `?siteKey=` on every request so the CORS preflight can resolve the key.

## 0.1.0

Initial release.
