// Sidebar mode configuration (embed#25, D7/D15/D16): validation + the
// inline-over-remote merge for layout, preset, agent, auto-open, chips and the
// WhatsApp continuation. Pure functions, no DOM — the scheduler and the UI read
// only what comes out of here.
//
// Same rules as the rest of the config (config.ts): every field optional, every
// malformed value falls back to a safe default instead of throwing, and inline
// beats the server field by field so a page can pin one thing and still let
// Vitrina decide the rest.

import { validateHttpUrl } from './theme';
import type {
  WidgetAgentConfig,
  WidgetAutoOpenConfig,
  WidgetAutoOpenDesktop,
  WidgetAutoOpenMobile,
  WidgetChipConfig,
  WidgetLayout,
  WidgetPreset,
  WidgetWhatsAppConfig,
} from './types';

/** The sidebar-related slice of `GET /widget/config` (server omits unset keys). */
export interface RemoteSidebarConfig {
  layout?: WidgetLayout;
  preset?: WidgetPreset;
  agent?: WidgetAgentConfig;
  autoOpen?: WidgetAutoOpenConfig;
  chips?: WidgetChipConfig[];
  whatsapp?: WidgetWhatsAppConfig;
  cta?: { label: string; target?: 'auto' | 'host' };
  demoWorld?: string;
  demoKind?: 'automotora' | 'clinica';
}

/** The inline slice of `WidgetConfig` this module reads. */
export interface InlineSidebarConfig extends RemoteSidebarConfig {
  anchor?: 'auto' | 'bottom-bar';
  launcherStyle?: 'tab' | 'bubble' | 'sidetab';
  pageContext?: Record<string, string>;
}

export interface ResolvedAgent {
  name: string;
  label: string;
  status: string | null;
  avatarUrl: string | null;
}

export interface ResolvedAutoOpen {
  enabled: boolean;
  delayMs: number;
  mobileDelayMs: number;
  desktop: WidgetAutoOpenDesktop;
  mobile: WidgetAutoOpenMobile;
  excludePaths: string[];
  variant: string | null;
  /** null = no scroll needed (the default). Else the minimum scroll, the larger of the two. */
  requireScroll: { px: number; viewport: number } | null;
}

export type ChipAction = 'message' | 'demo' | 'booking' | 'link' | 'compose';

export interface ResolvedChip {
  label: string;
  message: string;
  action: ChipAction;
  /** Scripted answer (0.18.0), or absent for a chip the assistant answers. */
  reply?: string;
  /** Chips under the scripted reply. */
  next?: ResolvedChip[];
  /** `link` only. */
  url?: string;
}

export interface ResolvedWhatsApp {
  number: string;
  text: string;
}

export interface ResolvedSidebar {
  layout: WidgetLayout;
  preset: WidgetPreset;
  anchor: 'auto' | 'bottom-bar';
  /** Collapsed desktop launcher: `tab` (default), `bubble` (round portrait) or `sidetab` (portrait + chat icon, no text). */
  launcherStyle: 'tab' | 'bubble' | 'sidetab';
  /** null ⇒ no named assistant: the header keeps today's title/logo. */
  agent: ResolvedAgent | null;
  autoOpen: ResolvedAutoOpen;
  chips: ResolvedChip[];
  whatsapp: ResolvedWhatsApp | null;
  pageContext: Record<string, string>;
  /** Pinned CTA label, or null for none. */
  ctaLabel: string | null;
  /** `host`: the CTA and booking chips always emit `cta`, never open the agenda. */
  ctaTarget: 'auto' | 'host';
  demoWorld: string | null;
  /** The world demo mode plays, when the page or the tenant says (else read off the name). */
  demoKind: 'automotora' | 'clinica' | null;
}

function kindOf(v: unknown): 'automotora' | 'clinica' | null {
  return v === 'automotora' || v === 'clinica' ? v : null;
}

export const DEFAULT_AUTO_OPEN_DELAY_S = 10;
export const MAX_CHIPS = 4;
export const MAX_CHIP_LABEL = 60;
export const MAX_CHIP_MESSAGE = 300;
export const MAX_CHIP_REPLY = 400;
/** Scripted replies in a row (the greeting's chips are level 1); the chips under the last are not scripted. */
export const MAX_CHIP_DEPTH = 3;
export const DEFAULT_SCROLL_VIEWPORT = 0.5;
export const MAX_AGENT_NAME = 24;
export const MAX_AGENT_LABEL = 48;
export const MAX_AGENT_STATUS = 40;
export const MAX_EXCLUDE_PATHS = 20;
export const MAX_PAGE_CONTEXT_KEYS = 8;
export const MAX_PAGE_CONTEXT_VALUE = 80;
export const DEFAULT_WHATSAPP_TEXT = 'Hola, sigo la conversación de la web (ref {ref})';

function text(input: unknown, max: number): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  return v === '' || v.length > max ? null : v;
}

function defined<T extends object>(source: T | undefined | null): Partial<T> {
  if (!source || typeof source !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

export function resolveLayout(input: unknown): WidgetLayout {
  return input === 'sidebar' || input === 'inline' ? input : 'bubble';
}

export function resolvePreset(input: unknown): WidgetPreset {
  return input === 'cream' ? 'cream' : 'default';
}

/**
 * A name AND a label, or no agent at all. A portrait without its disclosure
 * label is the one thing this widget must never paint (spec v3 hard rule:
 * never imply visitors won't notice it is an AI), so a missing label drops the
 * whole agent rather than rendering a nameless face or an unlabelled one.
 */
export function resolveAgent(input: WidgetAgentConfig | undefined): ResolvedAgent | null {
  const name = text(input?.name, MAX_AGENT_NAME);
  const label = text(input?.label, MAX_AGENT_LABEL);
  if (!name || !label) return null;
  return {
    name,
    label,
    status: text(input?.status, MAX_AGENT_STATUS),
    avatarUrl: validateHttpUrl(input?.avatarUrl),
  };
}

function seconds(input: unknown, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback;
  return Math.min(600, Math.max(1, input));
}

/** A path pattern: starts with '/', no whitespace, optional single trailing '*'. */
const PATH_PATTERN = /^\/[^\s*]*\*?$/;

export function resolveAutoOpen(input: WidgetAutoOpenConfig | undefined): ResolvedAutoOpen {
  const delay = seconds(input?.delaySeconds, DEFAULT_AUTO_OPEN_DELAY_S);
  const mobileDelay = seconds(input?.mobileDelaySeconds, delay);
  const desktop: WidgetAutoOpenDesktop =
    input?.desktop === 'teaser' || input?.desktop === 'off' ? input.desktop : 'panel';
  // A phone never gets the full panel on its own (D15): anything but 'off'
  // resolves to the teaser, including a 'panel' some config tried to set.
  const mobile: WidgetAutoOpenMobile = input?.mobile === 'off' ? 'off' : 'teaser';
  const excludePaths = Array.isArray(input?.excludePaths)
    ? input!.excludePaths
        .filter((p): p is string => typeof p === 'string' && PATH_PATTERN.test(p.trim()))
        .map((p) => p.trim())
        .slice(0, MAX_EXCLUDE_PATHS)
    : [];
  return {
    enabled: input?.enabled === true,
    delayMs: delay * 1000,
    mobileDelayMs: mobileDelay * 1000,
    desktop,
    mobile,
    excludePaths,
    variant: text(input?.variant, 40),
    requireScroll: resolveRequireScroll(input?.requireScroll),
  };
}

function bounded(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, v) : null;
}

/** `true` = half a window; an object needs at least one positive bound; anything else = off. */
export function resolveRequireScroll(input: unknown): ResolvedAutoOpen['requireScroll'] {
  if (input === true) return { px: 0, viewport: DEFAULT_SCROLL_VIEWPORT };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const { px, viewport } = input as { px?: unknown; viewport?: unknown };
  const p = bounded(px, 20_000);
  const v = bounded(viewport, 5);
  if (p === null && v === null) return null;
  return { px: p ?? 0, viewport: v ?? 0 };
}

const CHIP_ACTIONS = new Set<ChipAction>(['demo', 'booking', 'link', 'compose']);

/**
 * Malformed chips are dropped one by one, never the whole list. A scripted
 * tree holds at most MAX_CHIP_DEPTH replies in a row; a `link` chip without a valid http(s)
 * `url` is dropped (it would be a button that does nothing).
 */
export function resolveChips(input: unknown, depth = 1): ResolvedChip[] {
  if (!Array.isArray(input)) return [];
  const out: ResolvedChip[] = [];
  for (const raw of input) {
    if (out.length >= MAX_CHIPS) break;
    if (!raw || typeof raw !== 'object') continue;
    const chip = raw as WidgetChipConfig;
    const label = text(chip.label, MAX_CHIP_LABEL);
    if (!label) continue;
    const action: ChipAction = CHIP_ACTIONS.has(chip.action as ChipAction) ? (chip.action as ChipAction) : 'message';
    const resolved: ResolvedChip = { label, message: text(chip.message, MAX_CHIP_MESSAGE) ?? label, action };
    if (action === 'link') {
      const url = validateHttpUrl(chip.url);
      if (!url) continue;
      resolved.url = url;
    }
    // Only a chip that would otherwise go to the assistant can be answered
    // locally, and only down to MAX_CHIP_DEPTH replies: the chips under the
    // deepest reply are actions or questions for the assistant.
    const reply = action === 'message' && depth <= MAX_CHIP_DEPTH ? text(chip.reply, MAX_CHIP_REPLY) : null;
    if (reply) {
      resolved.reply = reply;
      const next = resolveChips(chip.next, depth + 1);
      if (next.length > 0) resolved.next = next;
    }
    out.push(resolved);
  }
  return out;
}

/** The chip at a tree path ("1", "1.0", "1.0.2"), or null. */
export function chipAt(chips: ResolvedChip[], path: string): ResolvedChip | null {
  if (!/^\d+(\.\d+){0,4}$/.test(path)) return null;
  let level: ResolvedChip[] | undefined = chips;
  let found: ResolvedChip | null = null;
  for (const part of path.split('.')) {
    found = level?.[Number(part)] ?? null;
    if (!found) return null;
    level = found.next;
  }
  return found;
}

/** wa.me wants the full international number as bare digits. */
export function normalizeWhatsAppNumber(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[\s()+\-.]/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function resolveWhatsApp(input: WidgetWhatsAppConfig | undefined): ResolvedWhatsApp | null {
  const number = normalizeWhatsAppNumber(input?.number);
  if (!number) return null;
  return { number, text: text(input?.text, 300) ?? DEFAULT_WHATSAPP_TEXT };
}

const CONTEXT_KEY = /^[a-z][a-z0-9_]{0,31}$/;

const PRICE_MODES = new Set(['first_ask', 'evaluation_only', 'never', 'script']);
const MAX_PRICE_SCRIPT = 400;

/** Sanitize the host's price policy into the wire shape (`price_policy`), or null to send nothing. */
export function resolvePricePolicy(input: unknown): { mode: string; script?: string } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const { mode, script } = input as { mode?: unknown; script?: unknown };
  if (typeof mode !== 'string' || !PRICE_MODES.has(mode)) return null;
  const s = typeof script === 'string' ? script.trim().slice(0, MAX_PRICE_SCRIPT).trim() : '';
  if (mode === 'script') return s ? { mode, script: s } : null;
  return s ? { mode, script: s } : { mode };
}

export function resolvePageContext(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_PAGE_CONTEXT_KEYS) break;
    if (!CONTEXT_KEY.test(k)) continue;
    const value = text(v, MAX_PAGE_CONTEXT_VALUE);
    if (value === null) continue;
    out[k] = value;
    n += 1;
  }
  return out;
}

/**
 * Inline over remote. `agent`, `autoOpen` and `whatsapp` merge FIELD-WISE (a
 * page can change the delay and keep the server's on/off); `chips` is a list
 * and is replaced wholesale, like `team`.
 */
export function resolveSidebar(
  inline: InlineSidebarConfig | undefined,
  remote: RemoteSidebarConfig | undefined | null,
): ResolvedSidebar {
  const agent = { ...defined(remote?.agent), ...defined(inline?.agent) };
  const autoOpen = { ...defined(remote?.autoOpen), ...defined(inline?.autoOpen) };
  const whatsapp = { ...defined(remote?.whatsapp), ...defined(inline?.whatsapp) };
  return {
    layout: resolveLayout(inline?.layout ?? remote?.layout),
    preset: resolvePreset(inline?.preset ?? remote?.preset),
    anchor: inline?.anchor === 'bottom-bar' ? 'bottom-bar' : 'auto',
    launcherStyle:
      inline?.launcherStyle === 'bubble' || inline?.launcherStyle === 'sidetab' ? inline.launcherStyle : 'tab',
    agent: resolveAgent(agent),
    autoOpen: resolveAutoOpen(autoOpen),
    chips: resolveChips(inline?.chips ?? remote?.chips),
    whatsapp: resolveWhatsApp(whatsapp as WidgetWhatsAppConfig),
    pageContext: resolvePageContext(inline?.pageContext),
    ctaLabel: text(inline?.cta?.label, 40) ?? text(remote?.cta?.label, 40),
    ctaTarget: (inline?.cta?.target ?? remote?.cta?.target) === 'host' ? 'host' : 'auto',
    demoWorld: text(inline?.demoWorld, 40) ?? text(remote?.demoWorld, 40),
    demoKind: kindOf(inline?.demoKind) ?? kindOf(remote?.demoKind),
  };
}

/**
 * The server's (or the localStorage cache's) sidebar fields, re-validated into
 * the INPUT shape so they can be layered under inline config. Anything
 * malformed is dropped rather than emitted, so it can never clobber a page's
 * own value. Auto-open keeps only the keys the server actually sent: a merge
 * must not see a default `desktop: 'panel'` the server never said.
 */
export function coerceRemoteSidebar(raw: Record<string, unknown>): RemoteSidebarConfig {
  const out: RemoteSidebarConfig = {};
  if (raw.layout === 'sidebar' || raw.layout === 'inline' || raw.layout === 'bubble') {
    out.layout = raw.layout;
  }
  if (raw.preset === 'cream' || raw.preset === 'default') out.preset = raw.preset;

  const a = raw.agent as Record<string, unknown> | null | undefined;
  if (a && typeof a === 'object') {
    const agent: WidgetAgentConfig = {};
    const name = text(a.name, MAX_AGENT_NAME);
    const label = text(a.label, MAX_AGENT_LABEL);
    const status = text(a.status, MAX_AGENT_STATUS);
    const avatarUrl = validateHttpUrl(a.avatarUrl as string);
    if (name) agent.name = name;
    if (label) agent.label = label;
    if (status) agent.status = status;
    if (avatarUrl) agent.avatarUrl = avatarUrl;
    if (Object.keys(agent).length > 0) out.agent = agent;
  }

  const ao = raw.autoOpen as Record<string, unknown> | null | undefined;
  if (ao && typeof ao === 'object') {
    const next: WidgetAutoOpenConfig = {};
    if (typeof ao.enabled === 'boolean') next.enabled = ao.enabled;
    if (typeof ao.delaySeconds === 'number' && Number.isFinite(ao.delaySeconds)) {
      next.delaySeconds = seconds(ao.delaySeconds, DEFAULT_AUTO_OPEN_DELAY_S);
    }
    if (typeof ao.mobileDelaySeconds === 'number' && Number.isFinite(ao.mobileDelaySeconds)) {
      next.mobileDelaySeconds = seconds(ao.mobileDelaySeconds, DEFAULT_AUTO_OPEN_DELAY_S);
    }
    if (ao.desktop === 'panel' || ao.desktop === 'teaser' || ao.desktop === 'off') {
      next.desktop = ao.desktop;
    }
    if (ao.mobile === 'teaser' || ao.mobile === 'off') next.mobile = ao.mobile;
    if (Array.isArray(ao.excludePaths)) {
      const paths = resolveAutoOpen({ excludePaths: ao.excludePaths as string[] }).excludePaths;
      if (paths.length > 0) next.excludePaths = paths;
    }
    const variant = text(ao.variant, 40);
    if (variant) next.variant = variant;
    const scroll = resolveRequireScroll(ao.requireScroll);
    if (scroll) next.requireScroll = scroll;
    if (Object.keys(next).length > 0) out.autoOpen = next;
  }

  const chips = resolveChips(raw.chips);
  if (chips.length > 0) out.chips = chips;

  const wa = raw.whatsapp as Record<string, unknown> | null | undefined;
  if (wa && typeof wa === 'object') {
    const number = normalizeWhatsAppNumber(wa.number);
    if (number) {
      const t = text(wa.text, 300);
      out.whatsapp = t ? { number, text: t } : { number };
    }
  }
  const cta = raw.cta as Record<string, unknown> | null | undefined;
  const ctaLabel = cta && typeof cta === 'object' ? text(cta.label, 40) : null;
  if (ctaLabel) out.cta = cta?.target === 'host' ? { label: ctaLabel, target: 'host' } : { label: ctaLabel };
  const world = text(raw.demoWorld, 40);
  if (world) out.demoWorld = world;
  const kind = kindOf(raw.demoKind);
  if (kind) out.demoKind = kind;
  return out;
}
