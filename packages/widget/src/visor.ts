// The floor-plan visor (vitrina-app#4810): a proyecto's plans on an
// inmobiliaria's own site, every placed unidad coloured by its LIVE status.
//
//   GET {api}/widget/projects/{id}/visor           plans, placed unidades, tipologías
//   GET {api}/widget/projects/{id}/visor/status    each unidad's status (polled)
//
// Auth is the widget's: `Authorization: Bearer <pk_>` plus `?siteKey=` so the
// preflight can name the key. The key is origin-locked server-side; a copy on
// another site answers 403 and the visor stays quiet.
//
// What it shows is whatever the server discloses: four public statuses and a
// price only when the proyecto publishes prices and only for a disponible
// unidad. Nothing here guesses a price or a status.
//
// RENDERING. One shadow root (the host page's CSS cannot reach in, ours cannot
// leak out). The plan is the image under an SVG in a 0..1 viewBox, so a shape
// is drawn in the fractions it is stored in and follows the image at any
// width. Labels are HTML chips (text in a stretched viewBox would stretch).
// Every shape is a real button: focusable, named «Departamento 501: disponible»,
// Enter/Space opens it. Colour is never the only carrier: the label and the
// legend name the estado, and `no_disponible` is dashed.
//
// POLLING. Every `refresh_seconds` (server's, default 30) the status read runs;
// only changed shapes are repainted. It pauses while the tab is hidden and
// refreshes once when it returns. A failed poll keeps what is on screen.
//
// CLICK. A tap on a unidad opens its card (number, tipología, measures, estado,
// price if disclosed) with «Consultar por esta unidad», which sets the unidad
// on the Vitrina chat (`setUnit`) and opens it with a message prefilled.

export type VisorStatus = 'disponible' | 'reservada' | 'vendida' | 'no_disponible';
export type Point = [number, number];

export interface VisorPrice {
  [k: string]: unknown;
}

export interface VisorUnit {
  id: string;
  unit_number: string;
  kind: string;
  status: VisorStatus;
  floor: number | null;
  orientation: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  usable_area_m2: number | null;
  terrace_area_m2: number | null;
  total_area_m2: number | null;
  unit_model_id: string | null;
  price: VisorPrice | null;
}

export interface VisorPlan {
  id: string;
  name: string;
  floor: number | null;
  image_url: string;
  image_width: number | null;
  image_height: number | null;
  units: Array<{ unit_id: string; shape: Point[] }>;
}

export interface VisorData {
  project: { id: string; name: string };
  show_prices: boolean;
  floor_plans: VisorPlan[];
  units: VisorUnit[];
  unit_models: Array<{ id: string; name: string }>;
  status_counts: Record<VisorStatus, number>;
  refresh_seconds: number;
  as_of: string;
}

export interface VisorStatusData {
  units: Array<{ id: string; status: VisorStatus }>;
  status_counts: Record<VisorStatus, number>;
  refresh_seconds: number;
}

export const STATUS_LABEL: Record<VisorStatus, string> = {
  disponible: 'Disponible',
  reservada: 'Reservada',
  vendida: 'Vendida',
  no_disponible: 'No disponible',
};

const STATUS_COLOR: Record<VisorStatus, { fill: string; stroke: string }> = {
  disponible: { fill: 'rgba(22,163,74,.34)', stroke: '#15803d' },
  reservada: { fill: 'rgba(217,119,6,.38)', stroke: '#b45309' },
  vendida: { fill: 'rgba(71,85,105,.55)', stroke: '#334155' },
  no_disponible: { fill: 'rgba(148,163,184,.12)', stroke: '#64748b' },
};

export const MIN_REFRESH_SECONDS = 10;
export const DEFAULT_REFRESH_SECONDS = 30;

/** The server's cadence, never faster than 10 s and never absent. */
export function refreshMs(seconds: unknown): number {
  const n = typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : DEFAULT_REFRESH_SECONDS;
  return Math.max(MIN_REFRESH_SECONDS, n) * 1000;
}

export function svgPoints(points: readonly Point[]): string {
  return points.map(([x, y]) => `${Math.round(x * 10000) / 10000},${Math.round(y * 10000) / 10000}`).join(' ');
}

/** Area-weighted centre, so the label sits inside an L-shaped unidad. */
export function centroid(points: readonly Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Which unidades changed status: id → new status. */
export function statusChanges(current: ReadonlyMap<string, VisorStatus>, next: VisorStatusData['units']): Map<string, VisorStatus> {
  const out = new Map<string, VisorStatus>();
  for (const u of next) if (current.get(u.id) !== undefined && current.get(u.id) !== u.status) out.set(u.id, u.status);
  return out;
}

export function isVisorStatus(x: unknown): x is VisorStatus {
  return x === 'disponible' || x === 'reservada' || x === 'vendida' || x === 'no_disponible';
}

/** Defensive read of the server's body: a malformed one is «no visor», never a throw. */
export function parseVisor(raw: unknown): VisorData | null {
  const d = (raw as { data?: unknown } | null)?.data as Partial<VisorData> | undefined;
  if (!d || !Array.isArray(d.floor_plans) || !Array.isArray(d.units)) return null;
  const plans = d.floor_plans.filter((p) => p && typeof p.image_url === 'string' && Array.isArray(p.units));
  return {
    project: d.project ?? { id: '', name: '' },
    show_prices: d.show_prices === true,
    floor_plans: plans,
    units: d.units.filter((u) => u && typeof u.id === 'string' && isVisorStatus(u.status)),
    unit_models: Array.isArray(d.unit_models) ? d.unit_models : [],
    status_counts: d.status_counts ?? ({} as VisorData['status_counts']),
    refresh_seconds: typeof d.refresh_seconds === 'number' ? d.refresh_seconds : DEFAULT_REFRESH_SECONDS,
    as_of: d.as_of ?? '',
  };
}

export function parseStatus(raw: unknown): VisorStatusData | null {
  const d = (raw as { data?: unknown } | null)?.data as Partial<VisorStatusData> | undefined;
  if (!d || !Array.isArray(d.units)) return null;
  return {
    units: d.units.filter((u) => u && typeof u.id === 'string' && isVisorStatus(u.status)),
    status_counts: d.status_counts ?? ({} as VisorStatusData['status_counts']),
    refresh_seconds: typeof d.refresh_seconds === 'number' ? d.refresh_seconds : DEFAULT_REFRESH_SECONDS,
  };
}

/** `«Departamento 501»`, `«Bodega B-01»`. */
export function unitTitle(u: Pick<VisorUnit, 'kind' | 'unit_number'>): string {
  const kind = { departamento: 'Departamento', casa: 'Casa', estacionamiento: 'Estacionamiento', bodega: 'Bodega' }[u.kind] ?? 'Unidad';
  return `${kind} ${u.unit_number}`;
}

function fmtM2(n: number | null): string | null {
  return n == null ? null : `${n.toLocaleString('es-CL', { maximumFractionDigits: 1 })} m²`;
}

/** A price as the server discloses it. Reads the display fields it knows; shows nothing it cannot read. */
export function priceText(price: VisorPrice | null): string | null {
  if (!price) return null;
  for (const k of ['display', 'formatted', 'label']) if (typeof price[k] === 'string') return price[k] as string;
  const amount = price.amount;
  const cur = price.currency;
  if (typeof amount === 'number' && typeof cur === 'string') {
    return cur === 'UF' ? `UF ${amount.toLocaleString('es-CL', { maximumFractionDigits: 2 })}` : `$${Math.round(amount).toLocaleString('es-CL')}`;
  }
  return null;
}

export function unitFacts(u: VisorUnit): string[] {
  return [
    u.bedrooms != null ? `${u.bedrooms} dorm.` : null,
    u.bathrooms != null ? `${u.bathrooms} ${u.bathrooms === 1 ? 'baño' : 'baños'}` : null,
    fmtM2(u.usable_area_m2) ? `${fmtM2(u.usable_area_m2)} útiles` : null,
    fmtM2(u.terrace_area_m2) && (u.terrace_area_m2 ?? 0) > 0 ? `${fmtM2(u.terrace_area_m2)} terraza` : null,
    u.orientation ? `Orientación ${u.orientation}` : null,
    u.floor != null ? `Piso ${u.floor}` : null,
  ].filter((x): x is string => Boolean(x));
}

// ── transport ───────────────────────────────────────────────────────────────

export interface VisorClientConfig {
  apiBaseUrl: string;
  publicKey: string;
  projectId: string;
  fetchImpl?: typeof fetch;
}

async function getJson(cfg: VisorClientConfig, path: string, etag?: string): Promise<{ status: number; body: unknown; etag: string | null }> {
  const f = cfg.fetchImpl ?? fetch;
  const url = `${cfg.apiBaseUrl.replace(/\/+$/, '')}${path}?siteKey=${encodeURIComponent(cfg.publicKey)}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.publicKey}` };
  if (etag) headers['If-None-Match'] = etag;
  const res = await f(url, { headers });
  if (res.status === 304) return { status: 304, body: null, etag: etag ?? null };
  if (!res.ok) return { status: res.status, body: null, etag: null };
  return { status: res.status, body: await res.json().catch(() => null), etag: res.headers.get('ETag') };
}

export const visorPath = (projectId: string) => `/widget/projects/${encodeURIComponent(projectId)}/visor`;

export async function fetchVisor(cfg: VisorClientConfig): Promise<VisorData | null> {
  try {
    const r = await getJson(cfg, visorPath(cfg.projectId));
    return r.status === 200 ? parseVisor(r.body) : null;
  } catch {
    return null;
  }
}

export async function fetchStatus(cfg: VisorClientConfig): Promise<VisorStatusData | null> {
  try {
    const r = await getJson(cfg, `${visorPath(cfg.projectId)}/status`);
    return r.status === 200 ? parseStatus(r.body) : null;
  } catch {
    return null;
  }
}

// ── view ────────────────────────────────────────────────────────────────────

export interface VisorChat {
  setUnit(id: string | null): void;
  open(): void;
  prefill(text: string): void;
}

export interface MountOptions extends VisorClientConfig {
  container: HTMLElement;
  /** The chat to hand a tapped unidad to; absent, the card has no «Consultar» button. */
  chat?: () => Promise<VisorChat | null>;
  /** Called after every successful status read (tests, host analytics). */
  onStatus?: (changed: number) => void;
}

export interface VisorHandle {
  destroy(): void;
  refresh(): Promise<void>;
}

const CSS = `
:host{display:block;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;color-scheme:light}
*{box-sizing:border-box}
.wrap{display:flex;flex-direction:column;gap:10px}
.tabs{display:flex;gap:6px;overflow-x:auto;padding:2px}
.tab{appearance:none;border:1px solid #cbd5e1;background:#fff;color:inherit;border-radius:999px;padding:6px 14px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap}
.tab[aria-selected=true]{background:#0f172a;border-color:#0f172a;color:#fff}
.tab:focus-visible,.shape:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
.stage{position:relative;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#f8fafc}
.stage img{display:block;width:100%;height:auto;pointer-events:none;user-select:none}
.stage svg{position:absolute;inset:0;width:100%;height:100%}
.shape{cursor:pointer;stroke-width:1.5;vector-effect:non-scaling-stroke;transition:fill .25s,stroke .25s,stroke-width .1s;outline:none}
.shape:hover,.shape.on{stroke-width:3}
.shape.no_disponible{stroke-dasharray:5 4}
.labels{position:absolute;inset:0;pointer-events:none}
.chip{color:#0f172a;position:absolute;transform:translate(-50%,-50%);background:rgba(255,255,255,.92);border-radius:5px;padding:1px 4px;font-size:11px;font-weight:700;line-height:1.2;box-shadow:0 0 0 1px rgba(15,23,42,.15);white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0;padding:0;list-style:none;font-size:12.5px;color:#475569}
.legend li{display:inline-flex;align-items:center;gap:6px}
.dot{width:11px;height:11px;border-radius:50%;border:2px solid}
.card{border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#fff;display:flex;flex-direction:column;gap:6px}
.card h3{margin:0;font-size:15px}
.row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 12px}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;border-radius:999px;padding:2px 10px;border:1px solid}
.facts{margin:0;color:#475569;font-size:13px}
.price{font-weight:700;font-size:15px}
.cta{appearance:none;border:0;border-radius:8px;background:#0f172a;color:#fff;font:inherit;font-weight:600;padding:8px 14px;cursor:pointer;align-self:flex-start}
.cta:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
.hint{margin:0;color:#64748b;font-size:13px}
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...kids: Array<Node | string>) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
};
const NS = 'http://www.w3.org/2000/svg';

export async function mountVisor(opts: MountOptions): Promise<VisorHandle | null> {
  const data = await fetchVisor(opts);
  if (!data || data.floor_plans.length === 0) return null;

  const host = opts.container;
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.replaceChildren(el('style', { textContent: CSS }));
  const wrap = el('div', { className: 'wrap' });
  root.append(wrap);

  const byId = new Map(data.units.map((u) => [u.id, u]));
  const status = new Map(data.units.map((u) => [u.id, u.status] as const));
  const shapes = new Map<string, SVGPolygonElement>();
  let planIndex = 0;
  let selected: string | null = null;

  const tabs = el('div', { className: 'tabs', role: 'tablist' });
  const stageHost = el('div');
  const card = el('div', { className: 'card' });
  card.setAttribute('aria-live', 'polite');
  const legend = el('ul', { className: 'legend' });
  for (const s of ['disponible', 'reservada', 'vendida'] as const) {
    const dot = el('span', { className: 'dot' });
    dot.style.background = STATUS_COLOR[s].fill;
    dot.style.borderColor = STATUS_COLOR[s].stroke;
    legend.append(el('li', {}, dot, STATUS_LABEL[s]));
  }
  if (data.units.some((u) => u.status === 'no_disponible')) {
    const dot = el('span', { className: 'dot' });
    dot.style.borderColor = STATUS_COLOR.no_disponible.stroke;
    dot.style.borderStyle = 'dashed';
    legend.append(el('li', {}, dot, STATUS_LABEL.no_disponible));
  }
  wrap.append(...(data.floor_plans.length > 1 ? [tabs] : []), stageHost, legend, card);

  function paint(id: string): void {
    const poly = shapes.get(id);
    const u = byId.get(id);
    if (!poly || !u) return;
    const s = status.get(id) ?? u.status;
    poly.setAttribute('fill', STATUS_COLOR[s].fill);
    poly.setAttribute('stroke', STATUS_COLOR[s].stroke);
    poly.setAttribute('class', `shape ${s}${selected === id ? ' on' : ''}`);
    poly.setAttribute('aria-label', `${unitTitle(u)}: ${STATUS_LABEL[s].toLowerCase()}`);
  }

  function renderCard(): void {
    card.replaceChildren();
    const u = selected ? byId.get(selected) : null;
    if (!u) {
      card.append(el('p', { className: 'hint', textContent: 'Toca una unidad para ver su estado y consultar por ella.' }));
      return;
    }
    const s = status.get(u.id) ?? u.status;
    const pill = el('span', { className: 'pill', textContent: STATUS_LABEL[s] });
    pill.style.borderColor = STATUS_COLOR[s].stroke;
    pill.style.color = STATUS_COLOR[s].stroke;
    const model = data.unit_models.find((m) => m.id === u.unit_model_id);
    const price = s === 'disponible' ? priceText(u.price) : null;
    card.append(
      el('div', { className: 'row' }, el('h3', { textContent: unitTitle(u) + (model ? ` · ${model.name}` : '') }), pill),
      el('p', { className: 'facts', textContent: unitFacts(u).join(' · ') }),
    );
    if (price) card.append(el('div', { className: 'price', textContent: price }));
    if (opts.chat && s !== 'vendida') {
      const cta = el('button', { className: 'cta', type: 'button', textContent: 'Consultar por esta unidad' });
      cta.addEventListener('click', () => {
        void opts.chat!().then((chat) => {
          if (!chat) return;
          chat.setUnit(u.id);
          chat.prefill(`Hola, quiero consultar por la unidad: ${unitTitle(u)}.`);
          chat.open();
        });
      });
      card.append(cta);
    }
  }

  function select(id: string): void {
    const prev = selected;
    selected = id;
    if (prev) paint(prev);
    paint(id);
    renderCard();
  }

  function renderPlan(): void {
    const plan = data!.floor_plans[planIndex]!;
    shapes.clear();
    const stage = el('div', { className: 'stage' });
    const img = el('img', { src: plan.image_url, alt: plan.name, draggable: false });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.setAttribute('preserveAspectRatio', 'none');
    const labels = el('div', { className: 'labels' });
    for (const placed of plan.units) {
      const u = byId.get(placed.unit_id);
      if (!u) continue;
      const poly = document.createElementNS(NS, 'polygon');
      poly.setAttribute('points', svgPoints(placed.shape));
      poly.setAttribute('tabindex', '0');
      poly.setAttribute('role', 'button');
      poly.addEventListener('click', () => select(u.id));
      poly.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select(u.id);
        }
      });
      svg.append(poly);
      shapes.set(u.id, poly);
      const [x, y] = centroid(placed.shape);
      const chip = el('span', { className: 'chip', textContent: u.unit_number });
      chip.style.left = `${x * 100}%`;
      chip.style.top = `${y * 100}%`;
      labels.append(chip);
      paint(u.id);
    }
    stage.append(img, svg, labels);
    stageHost.replaceChildren(stage);
  }

  function renderTabs(): void {
    tabs.replaceChildren(
      ...data!.floor_plans.map((p, i) => {
        const t = el('button', { className: 'tab', type: 'button', textContent: p.name });
        t.setAttribute('role', 'tab');
        t.setAttribute('aria-selected', String(i === planIndex));
        t.addEventListener('click', () => {
          planIndex = i;
          renderTabs();
          renderPlan();
        });
        return t;
      }),
    );
  }

  renderTabs();
  renderPlan();
  renderCard();

  async function refresh(): Promise<void> {
    const next = await fetchStatus(opts);
    if (!next) return;
    const changed = statusChanges(status, next.units);
    for (const [id, s] of changed) {
      status.set(id, s);
      paint(id);
    }
    if (selected && changed.has(selected)) renderCard();
    timerMs = refreshMs(next.refresh_seconds);
    opts.onStatus?.(changed.size);
  }

  let timerMs = refreshMs(data.refresh_seconds);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const tick = async () => {
    timer = null;
    if (stopped) return;
    if (!document.hidden) await refresh();
    if (!stopped) timer = setTimeout(() => void tick(), timerMs);
  };
  const onVisible = () => {
    if (!document.hidden && !stopped) {
      if (timer) clearTimeout(timer);
      void tick();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  timer = setTimeout(() => void tick(), timerMs);

  return {
    refresh,
    destroy() {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      root.replaceChildren();
    },
  };
}
