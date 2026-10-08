// The ad click a clinic booking carries: utm_id (Meta's {{campaign.id}}) must
// survive the landing URL → sessionStorage → booking path, because the backend
// files a booking on its campaign by utm_id when no ad id is present.
import { beforeEach, describe, expect, it } from 'vitest';

import { bookingAttribution, captureLandingClick } from '../src/clinic-attribution';

function winAt(search: string): Window {
  const store = new Map<string, string>();
  return {
    location: { search },
    document: { cookie: '' },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  } as unknown as Window;
}

describe('clinic booking attribution — utm_id', () => {
  beforeEach(() => window.localStorage?.clear());

  it('reads utm_id off the live URL', () => {
    const win = winAt('?utm_source=fb&utm_id=120210000000000002');
    expect(bookingAttribution(win)).toMatchObject({
      utm_source: 'fb',
      utm_id: '120210000000000002',
    });
  });

  it('remembers utm_id for the tab and sends it from a later page with no params', () => {
    const landing = winAt('?utm_content=555&utm_id=120210000000000002');
    captureLandingClick(landing);
    const later = {
      ...landing,
      location: { search: '' },
    } as unknown as Window;
    expect(bookingAttribution(later)).toMatchObject({
      utm_content: '555',
      utm_id: '120210000000000002',
    });
  });
});
