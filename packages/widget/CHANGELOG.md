# @vitrina/widget

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
