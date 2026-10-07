// vitrina-app#3701 — the tag carries the tracker's anonymous visitor id across
// domains to the hosted booking page: a link (or booking iframe) pointing at
// `booking_link.origin + path_prefix` gets `?vt_aid=<id>` at the moment it is
// used, and nothing else on the page is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decorateBookingUrl,
  installBookingLinkDecoration,
  readTrackerAnonymousId,
} from '../src/booking-link';

const CONFIG = { origin: 'https://app.vitrinadev.com', path_prefix: '/reserva/', param: 'vt_aid' };
const BOOKING = 'https://app.vitrinadev.com/reserva/AbCdEfGhIjKlMnOpQrSt';
const ANON = 'anon_1a2b3c4d5e';

function anchor(href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  a.textContent = 'Agendar';
  // A click must not navigate the test document away.
  a.addEventListener('click', (e) => e.preventDefault());
  document.body.appendChild(a);
  return a;
}

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = 'atribu_visitor_id=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  document.body.innerHTML = '';
});

let uninstall: () => void = () => undefined;
function install(config: Parameters<typeof installBookingLinkDecoration>[0]): void {
  uninstall = installBookingLinkDecoration(config);
}

afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

describe('decorateBookingUrl (pure)', () => {
  it('appends the id to a booking page link, keeping its own query', () => {
    expect(decorateBookingUrl(`${BOOKING}?utm_source=site`, CONFIG, ANON)).toBe(
      `${BOOKING}?utm_source=site&vt_aid=${ANON}`,
    );
  });

  it('leaves every other link alone, and never decorates twice', () => {
    expect(decorateBookingUrl('https://app.vitrinadev.com/signin', CONFIG, ANON)).toBeNull();
    expect(decorateBookingUrl('https://clinica.cl/reserva/x', CONFIG, ANON)).toBeNull();
    expect(decorateBookingUrl(`${BOOKING}?vt_aid=other`, CONFIG, ANON)).toBeNull();
    expect(decorateBookingUrl('not a url', CONFIG, ANON)).toBeNull();
  });
});

describe('readTrackerAnonymousId', () => {
  it('reads the tracker’s stored id, else its visitor cookie', () => {
    expect(readTrackerAnonymousId()).toBeNull();
    document.cookie = `atribu_visitor_id=${ANON}; path=/`;
    expect(readTrackerAnonymousId()).toBe(ANON);
    window.localStorage.setItem('atribu_anon_id', 'anon_from_storage');
    expect(readTrackerAnonymousId()).toBe('anon_from_storage');
  });

  it('ignores a value that is not an id', () => {
    window.localStorage.setItem('atribu_anon_id', 'has spaces in it');
    expect(readTrackerAnonymousId()).toBeNull();
  });
});

describe('installBookingLinkDecoration', () => {
  it('decorates the booking link when it is clicked, and only that link', () => {
    window.localStorage.setItem('atribu_anon_id', ANON);
    install(CONFIG);
    const book = anchor(BOOKING);
    const other = anchor('https://clinica.cl/contacto');
    book.click();
    other.click();
    expect(book.getAttribute('href')).toBe(`${BOOKING}?vt_aid=${ANON}`);
    expect(other.getAttribute('href')).toBe('https://clinica.cl/contacto');
  });

  it('leaves the link exactly as it was when the tracker has no id (consent denied)', () => {
    install(CONFIG);
    const book = anchor(BOOKING);
    book.click();
    expect(book.getAttribute('href')).toBe(BOOKING);
  });

  it('decorates an embedded booking iframe once the tracker has an id', () => {
    vi.useFakeTimers();
    const frame = document.createElement('iframe');
    frame.setAttribute('src', BOOKING);
    document.body.appendChild(frame);
    install(CONFIG);
    expect(frame.getAttribute('src')).toBe(BOOKING);
    // The tracker boots after the tag on a first visit.
    window.localStorage.setItem('atribu_anon_id', ANON);
    vi.advanceTimersByTime(1000);
    expect(frame.getAttribute('src')).toBe(`${BOOKING}?vt_aid=${ANON}`);
  });

  it('does nothing at all without a usable config', () => {
    window.localStorage.setItem('atribu_anon_id', ANON);
    install(null);
    const book = anchor(BOOKING);
    book.click();
    expect(book.getAttribute('href')).toBe(BOOKING);
  });
});
