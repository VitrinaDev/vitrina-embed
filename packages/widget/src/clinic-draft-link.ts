// The recovery link's way back into the widget (embed#18, vitrina-app#3706).
//
// A patient who left the details step with the WhatsApp box ticked gets ONE
// message whose link goes to the API's resume route, which 302s a widget draft
// back to the page it was saved on with `?vt_draft=<token>`. The widget reads
// that parameter at init and reopens the booking at the draft.

/**
 * The query parameter the recovery link carries. Mirrors vitrina-app's
 * `BOOKING_DRAFT_PARAM` and the hosted page's: change it nowhere without the
 * other two.
 */
export const BOOKING_DRAFT_PARAM = 'vt_draft';

/** The column's own CHECK (`booking_draft.resume_token`). */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,80}$/;

/** The resume token on this page's URL, or null. */
export function readDraftToken(win: Window = window): string | null {
  try {
    const raw = new URLSearchParams(win.location?.search ?? '').get(BOOKING_DRAFT_PARAM)?.trim();
    return raw && TOKEN_SHAPE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The page a draft's recovery link should reopen: this one, without its hash
 * and without a stale `vt_draft`. The server keeps it only on an origin the
 * key is allowed on.
 */
export function draftReturnUrl(win: Window = window): string | null {
  try {
    const url = new URL(win.location.href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    url.searchParams.delete(BOOKING_DRAFT_PARAM);
    const out = url.toString();
    return out.length <= 2000 ? out : null;
  } catch {
    return null;
  }
}

const HANDLED_KEY = 'vitrina_draft_resumed';

/**
 * Has this tab already reopened this draft? A reload of the page the link
 * opened must not pop the booking up again over what the patient is doing.
 */
export function draftAlreadyHandled(token: string, win: Window = window): boolean {
  try {
    return win.sessionStorage?.getItem(HANDLED_KEY) === token;
  } catch {
    return false;
  }
}

export function markDraftHandled(token: string, win: Window = window): void {
  try {
    win.sessionStorage?.setItem(HANDLED_KEY, token);
  } catch {
    /* storage blocked — at worst the booking reopens once more */
  }
}
