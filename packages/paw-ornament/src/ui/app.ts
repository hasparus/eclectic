import type { ThinSpot } from "../core/cleanup";
import type { PadInfo, Stats } from "../generate";
import { DEFAULTS, MAIN_MOTIFS, MAIN_PAD, normalizeParams, padWindow, TOE_MOTIFS, type Params, type TextMask } from "../index";
import type { Job } from "../worker";
import { Engine, Superseded } from "./engine";
import { detectLang, formatNumber, STRINGS, type Lang, type Strings } from "./i18n";
import { LASER_MM_PER_S, MATERIALS, formatDuration, materialFilter, ribbon, runLaser, Swing, type LaserRun, type Material } from "./showcase";
import { textMask } from "./text";

interface Preview {
  d: string;
  bbox: { x: number; y: number; w: number; h: number };
  u: number;
  stats: Stats;
  pads: PadInfo[];
  hole: { x: number; y: number; r: number } | null;
  thinSpots: ThinSpot[];
  params: Params;
}

const SVGNS = "http://www.w3.org/2000/svg";
const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  parent?.appendChild(n);
  return n;
};
const outlinePath = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
const ignoreSuperseded = (e: unknown) => {
  if (!(e instanceof Superseded)) console.error(e);
};

// ------------------------------------------------------------ persistence
const KEY = "paw-ornament:v2";
const storage = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: settings just are not remembered */
    }
  },
};
function loadParams(): Params {
  const raw = storage.get(KEY) ?? storage.get("paw-ornament:v1");
  try {
    return normalizeParams(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeParams({});
  }
}

// ------------------------------------------------------------ state
const engine = new Engine();
let params = loadParams();
let selected = Number(storage.get(`${KEY}:pad`) ?? 1) || 0;
let lang: Lang = detectLang(storage.get(`${KEY}:lang`));
let S: Strings = STRINGS[lang];
type View = "fill" | "cut" | "material" | "laser";
let view: View = "material";
let material: Material = (MATERIALS as readonly string[]).includes(storage.get(`${KEY}:material`) ?? "") ? (storage.get(`${KEY}:material`) as Material) : "birch";
const swing = new Swing();
let laser: LaserRun | null = null;
let showThin = true;
let last: Preview | null = null;
let padInfo: PadInfo[] = [];

const past: string[] = [];
let future: string[] = [];
let lastKey: string | undefined;
let lastTime = 0;

/** Applies a change. Changes with the same key in quick succession (a slider drag) are one undo step. */
function commit(next: unknown, key?: string): void {
  const now = Date.now();
  const before = JSON.stringify(params);
  const normalized = normalizeParams(next);
  if (JSON.stringify(normalized) === before) return;
  if (!(key && key === lastKey && now - lastTime < 1200)) {
    past.push(before);
    if (past.length > 200) past.shift();
  }
  future = [];
  lastKey = key;
  lastTime = now;
  params = normalized;
  refresh();
}
function undo(): void {
  const prev = past.pop();
  if (!prev) return;
  future.push(JSON.stringify(params));
  params = normalizeParams(JSON.parse(prev));
  lastKey = undefined;
  refresh();
}
function redo(): void {
  const next = future.pop();
  if (!next) return;
  past.push(JSON.stringify(params));
  params = normalizeParams(JSON.parse(next));
  lastKey = undefined;
  refresh();
}

function setPad(index: number, motif: string, variant?: number): void {
  const p = structuredClone(params);
  if (index === MAIN_PAD) p.main = { motif: motif as Params["main"]["motif"], variant: variant ?? (p.main.motif === motif ? p.main.variant : 0) };
  else {
    const cur = p.toes[index]!;
    p.toes[index] = { motif: motif as Params["toes"][number]["motif"], variant: variant ?? (cur.motif === motif ? cur.variant : 0) };
  }
  commit(p, `pad${index}:${motif}`);
}
const motifOf = (p: Params, i: number) => (i === MAIN_PAD ? p.main : p.toes[i]!);

async function currentMask(): Promise<TextMask | undefined> {
  return (await textMask(params.name.text, params.name.font)) ?? undefined;
}

// ------------------------------------------------------------ preview
let previewGen = 0;
let finalTimer: ReturnType<typeof setTimeout> | undefined;
async function schedulePreview(): Promise<void> {
  const gen = ++previewGen;
  const stage = $("stage");
  stage.classList.add("working");
  clearTimeout(finalTimer);
  const mask = await currentMask();
  if (gen !== previewGen) return;
  const job = (resolution: number, checkThin: boolean): Job => ({
    kind: "preview",
    params: { ...params, resolution },
    opts: { textMask: mask, checkThin },
  });
  try {
    // a quick draft first, then the full-resolution pass with the thin-spot check
    const draft = await engine.request<Preview>("preview", job(560, false), 0);
    if (gen !== previewGen) return;
    show(draft);
    finalTimer = setTimeout(() => {
      engine
        .request<Preview>("preview", job(1000, true), 0)
        .then((full) => {
          if (gen !== previewGen) return;
          show(full);
          stage.classList.remove("working");
        })
        .catch(ignoreSuperseded);
    }, 220);
  } catch (e) {
    ignoreSuperseded(e);
    if (!(e instanceof Superseded)) note(S.failed((e as Error).message));
  }
}

function show(res: Preview): void {
  const padsChanged = !last || last.params.paw !== res.params.paw || last.params.widthMm !== res.params.widthMm || last.params.ringMm !== res.params.ringMm || last.params.borderMm !== res.params.borderMm;
  last = res;
  padInfo = res.pads;
  if (laser) return; // the laser keeps cutting the design it started with; the newest one is drawn after
  drawPreview();
  if (padsChanged) {
    drawPicker();
    schedulePalette();
  }
}

function drawPreview(): void {
  if (!last || laser) return;
  const { d, bbox, u, stats, pads, thinSpots, hole } = last;
  const svg = $<SVGSVGElement>("preview");
  swing.stop();
  const m = 5 * u;
  const ruleH = 9 * u;
  const hang = view === "material" && hole ? 16 * u : 0;
  const region = { x: bbox.x - m, y: bbox.y - m - hang, w: bbox.w + 2 * m, h: bbox.h + 2 * m + ruleH + hang };
  svg.setAttribute("viewBox", `${region.x} ${region.y} ${region.w} ${region.h}`);
  svg.replaceChildren();
  const stage = $("stage");
  stage.dataset.view = view;
  let host: SVGElement = svg;
  if (view === "material") {
    const defs = svgEl("defs", {}, svg);
    materialFilter(defs, "mat", material, u, region);
    const g = svgEl("g", {}, svg);
    host = g;
    if (hole) ribbon(g, hole.x, hole.y, hole.r, bbox.y - hang + 4 * u, u);
    svgEl("path", { d, fill: "#000", "fill-rule": "evenodd", filter: "url(#mat)" }, g);
    if (hole) swing.start(g, [hole.x, bbox.y - hang + 4 * u]);
  } else {
    svgEl("path", { d, class: view === "cut" ? "cutline" : "material", "fill-rule": "evenodd" }, svg);
  }
  const overlay = svgEl("g", { "aria-hidden": "true" }, host);
  for (const pad of pads) {
    const hit = svgEl("path", { d: outlinePath(pad.outline), class: `pad-hit${pad.index === selected ? " selected" : ""}` }, overlay);
    hit.addEventListener("click", () => select(pad.index));
    svgEl("title", {}, hit).textContent = S.pad[pad.index]!;
  }
  if (showThin) for (const t of thinSpots) svgEl("circle", { cx: t.x, cy: t.y, r: Math.max(t.r, 2.2 * u), class: "thin" }, host);
  drawRule(svg, bbox, u, stats, m);
  drawStats();
}

function drawRule(svg: SVGSVGElement, bbox: Preview["bbox"], u: number, stats: Stats, m: number): void {
  const g = svgEl("g", { class: "rule" }, svg);
  const y = bbox.y + bbox.h + m * 0.8;
  const mm = Math.floor(stats.widthMm);
  svgEl("line", { x1: bbox.x, y1: y, x2: bbox.x + mm * u, y2: y }, g);
  const labelEvery = mm > 120 ? 20 : 10;
  for (let i = 0; i <= mm; i++) {
    const x = bbox.x + i * u;
    const h = i % 10 === 0 ? 2.4 * u : i % 5 === 0 ? 1.6 * u : 0.9 * u;
    svgEl("line", { x1: x, y1: y, x2: x, y2: y + h }, g);
    if (i % labelEvery === 0) svgEl("text", { x, y: y + 5.6 * u, "font-size": 2.5 * u, "text-anchor": "middle" }, g).textContent = String(i);
  }
  svgEl("text", { x: bbox.x + mm * u + 1.5 * u, y: y + 5.6 * u, "font-size": 2.5 * u }, g).textContent = "mm";
}

function setView(next: View): void {
  view = next;
  const radio = document.getElementById(`view-${next}`) as HTMLInputElement | null;
  if (radio) radio.checked = true;
  $("material-row").hidden = next !== "material";
  drawPreview();
}

function startLaser(): void {
  if (laser) {
    laser.stop();
    laser = null;
    $("laser").textContent = S.laser;
    setView("material");
    note("");
    return;
  }
  if (!last) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setView("material");
    note(S.laserDone(formatDuration(last.stats.cutLengthMm / LASER_MM_PER_S)));
    return;
  }
  const { d, bbox, u, stats } = last;
  swing.stop();
  const svg = $<SVGSVGElement>("preview");
  const m = 5 * u;
  const region = { x: bbox.x - m, y: bbox.y - m, w: bbox.w + 2 * m, h: bbox.h + 2 * m };
  svg.setAttribute("viewBox", `${region.x} ${region.y} ${region.w} ${region.h + 9 * u}`);
  svg.replaceChildren();
  $("stage").dataset.view = "laser";
  const total = formatDuration(stats.cutLengthMm / LASER_MM_PER_S);
  $("laser").textContent = S.stop;
  laser = runLaser(
    svg,
    d,
    u,
    region,
    (f) => note(S.laserProgress(Math.round(f * 100), formatDuration((f * stats.cutLengthMm) / LASER_MM_PER_S), total)),
    () => {
      laser = null;
      $("laser").textContent = S.laser;
      setView("material");
      const preview = $("preview");
      preview.classList.remove("reveal");
      void preview.getBoundingClientRect();
      preview.classList.add("reveal");
      note(S.laserDone(total));
    },
  );
}

function drawStats(): void {
  if (!last) return;
  const { stats } = last;
  const box = $("stats");
  box.replaceChildren();
  const item = (label: string, value: string) => {
    const sp = document.createElement("span");
    const b = document.createElement("b");
    b.textContent = value;
    sp.append(`${label} `, b);
    box.append(sp);
  };
  const f = (v: number, d = 1) => formatNumber(lang, v, d);
  item(S.size, `${f(stats.widthMm)} × ${f(stats.heightMm)} mm`);
  item(S.cutPath, stats.cutLengthMm >= 1000 ? `${f(stats.cutLengthMm / 1000, 2)} m` : `${Math.round(stats.cutLengthMm)} mm`);
  item(S.openings, String(stats.openings));
  item(S.laserTime, `≈ ${formatDuration(stats.cutLengthMm / LASER_MM_PER_S)}`);
  const pill = (text: string, warn = false) => {
    const p = document.createElement("span");
    p.className = warn ? "pill warn" : "pill";
    p.textContent = text;
    box.append(p);
  };
  pill(stats.bridgesAdded ? `${S.onePiece} · ${S.bridges(stats.bridgesAdded)}` : S.onePiece);
  if (last.thinSpots.length) pill(S.thinSpots(last.thinSpots.length), true);
}

// ------------------------------------------------------------ pad picker + palette
function select(i: number): void {
  if (i === selected) return;
  selected = i;
  storage.set(`${KEY}:pad`, String(i));
  drawPreview();
  drawPicker();
  syncControls();
  schedulePalette();
}

function drawPicker(): void {
  const svg = $<SVGSVGElement>("picker");
  if (!padInfo.length) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of padInfo) {
    x0 = Math.min(x0, p.box.x0);
    y0 = Math.min(y0, p.box.y0);
    x1 = Math.max(x1, p.box.x1);
    y1 = Math.max(y1, p.box.y1);
  }
  svg.setAttribute("viewBox", `${x0 - 20} ${y0 - 20} ${x1 - x0 + 40} ${y1 - y0 + 40}`);
  svg.replaceChildren();
  for (const p of padInfo) {
    const motif = motifOf(params, p.index).motif;
    const label = `${S.pad[p.index]}: ${p.index === MAIN_PAD ? S.main[motif as keyof Strings["main"]] : S.toe[motif as keyof Strings["toe"]]}`;
    const path = svgEl("path", { d: outlinePath(p.outline), role: "radio", tabindex: p.index === selected ? 0 : -1, "aria-checked": String(p.index === selected), "aria-label": label }, svg);
    svgEl("title", {}, path).textContent = label;
    path.addEventListener("click", () => select(p.index));
    path.addEventListener("keydown", (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === "ArrowRight" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowUp") {
        e.preventDefault();
        const step = k === "ArrowRight" || k === "ArrowDown" ? 1 : -1;
        select((selected + step + padInfo.length) % padInfo.length);
        ($<SVGSVGElement>("picker").querySelector('[aria-checked="true"]') as SVGPathElement | null)?.focus();
      }
    });
  }
  const motif = motifOf(params, selected).motif;
  const picked = $("picked");
  const b = document.createElement("b");
  b.textContent = S.pad[selected]!;
  const span = document.createElement("span");
  span.textContent = selected === MAIN_PAD ? S.main[motif as keyof Strings["main"]] : S.toe[motif as keyof Strings["toe"]];
  picked.replaceChildren(b, span);
  ($("apply-toes") as HTMLButtonElement).disabled = selected === MAIN_PAD;
}

let paletteGen = 0;
let paletteTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePalette(): void {
  clearTimeout(paletteTimer);
  paletteTimer = setTimeout(() => void drawPalette(), 120);
}
async function drawPalette(): Promise<void> {
  const gen = ++paletteGen;
  const box = $("palette");
  const list: readonly string[] = selected === MAIN_PAD ? MAIN_MOTIFS : TOE_MOTIFS;
  const current = motifOf(params, selected).motif;
  const names = selected === MAIN_PAD ? S.main : S.toe;
  const pad = padInfo[selected];
  if (box.children.length !== list.length || box.dataset.pad !== String(selected)) {
    box.replaceChildren();
    box.dataset.pad = String(selected);
    for (const m of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile";
      b.dataset.motif = m;
      b.append(svgEl("svg", { viewBox: "0 0 1 1", "aria-hidden": "true" }), document.createElement("span"));
      b.addEventListener("click", () => setPad(selected, m));
      box.append(b);
    }
  }
  for (const b of Array.from(box.children) as HTMLButtonElement[]) {
    const m = b.dataset.motif!;
    b.setAttribute("aria-pressed", String(m === current));
    b.lastElementChild!.textContent = names[m as keyof typeof names];
  }
  if (!pad) return;
  engine.cancel("tile");
  const mask = await currentMask();
  const win = padWindow(pad.box, 34);
  const tiles = Array.from(box.children) as HTMLButtonElement[];
  await Promise.all(
    tiles.map(async (b, k) => {
      const m = b.dataset.motif!;
      const p = structuredClone(params);
      const variant = m === current ? motifOf(params, selected).variant : 0;
      if (selected === MAIN_PAD) p.main = { motif: m as Params["main"]["motif"], variant };
      else p.toes[selected] = { motif: m as Params["toes"][number]["motif"], variant };
      try {
        const res = await engine.request<{ d: string }>(`tile${k}`, { kind: "crop", params: { ...p, resolution: 150 }, opts: { window: win, textMask: mask } }, 2);
        if (gen !== paletteGen) return;
        const svg = b.firstElementChild as SVGSVGElement;
        svg.setAttribute("viewBox", `${win.x0} ${win.y0} ${win.x1 - win.x0} ${win.y1 - win.y0}`);
        svg.replaceChildren();
        svgEl("path", { d: res.d, class: "material", "fill-rule": "evenodd" }, svg);
        b.classList.add("ready");
      } catch (e) {
        ignoreSuperseded(e);
      }
    }),
  );
}

// ------------------------------------------------------------ variations
const WORDS = ["szron", "zima", "snieg", "sanki", "mroz", "sopel", "choinka", "bombka", "lapka", "gwiazdka", "kulig", "puch", "zaspa", "pierniczek"];
const randomSeed = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(10 + Math.random() * 90)}`;
let thumbSeeds = Array.from({ length: 6 }, randomSeed);
let thumbGen = 0;
let thumbTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleThumbs(): void {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => void drawThumbs(), 400);
}
async function drawThumbs(): Promise<void> {
  const gen = ++thumbGen;
  const box = $("thumbs");
  if (box.children.length !== thumbSeeds.length) {
    box.replaceChildren();
    for (let i = 0; i < thumbSeeds.length; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "thumb";
      b.append(svgEl("svg", { viewBox: "0 0 1 1", "aria-hidden": "true" }), document.createElement("span"));
      b.addEventListener("click", () => {
        commit({ ...params, seed: b.dataset.seed }, "seed-pick");
        window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
      box.append(b);
    }
  }
  engine.cancel("thumb");
  const mask = await currentMask();
  await Promise.all(
    thumbSeeds.map(async (seed, i) => {
      const b = box.children[i] as HTMLButtonElement;
      b.dataset.seed = seed;
      b.lastElementChild!.textContent = seed;
      b.setAttribute("aria-label", S.useSeed(seed));
      try {
        const r = await engine.request<Preview>(`thumb${i}`, { kind: "preview", params: { ...params, seed, resolution: 300 }, opts: { textMask: mask } }, 3);
        if (gen !== thumbGen) return;
        const svg = b.firstElementChild as SVGSVGElement;
        const m = 3 * r.u;
        svg.setAttribute("viewBox", `${r.bbox.x - m} ${r.bbox.y - m} ${r.bbox.w + 2 * m} ${r.bbox.h + 2 * m}`);
        svg.replaceChildren();
        svgEl("path", { d: r.d, class: "material", "fill-rule": "evenodd" }, svg);
      } catch (e) {
        ignoreSuperseded(e);
      }
    }),
  );
}

// ------------------------------------------------------------ export
const note = (...content: (string | Node)[]) => $("note").replaceChildren(...content);
const fileBase = () =>
  `lapka-${params.paw}-${params.seed
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/[^\w-]+/g, "_")}`;

type DownloadsApi = { save(r: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }): Promise<unknown> };
const downloadsReady: Promise<DownloadsApi | null> = (async () => {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!c?.use) return null;
  try {
    return ((await c.use("downloads")) as DownloadsApi | null) ?? null;
  } catch {
    return null;
  }
})();

async function deliver(filename: string, data: string | Blob | Uint8Array, mime: string): Promise<void> {
  const dl = await downloadsReady;
  if (dl) {
    try {
      await dl.save({ filename, data });
      note(S.saved(filename));
    } catch (e) {
      const code = (e as { code?: string })?.code;
      note(code === "declined" ? S.cancelled : code === "rate_limited" ? S.busySave : S.noDownloads);
    }
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  note(S.downloaded(filename));
}

async function exportJob<T>(format: Extract<Job, { kind: "export" }>["format"]): Promise<T> {
  const mask = await currentMask();
  return engine.request<T>("export", { kind: "export", format, params: { ...params, resolution: 1500 }, opts: { textMask: mask } }, 0);
}

async function withBusy(fn: () => Promise<void>): Promise<void> {
  const buttons = Array.from($("exports").querySelectorAll("button"));
  buttons.forEach((b) => (b.disabled = true));
  note(S.preparing);
  try {
    await fn();
  } catch (e) {
    note(S.failed((e as Error).message));
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function exportFile(format: "svg-fill" | "svg-cut" | "pdf-fill"): Promise<void> {
  return withBusy(async () => {
    const { data } = await exportJob<{ data: string | Uint8Array }>(format);
    const pdf = format.startsWith("pdf");
    await deliver(`${fileBase()}${format === "svg-cut" ? "-cut" : ""}.${pdf ? "pdf" : "svg"}`, data, pdf ? "application/pdf" : "image/svg+xml");
  });
}

function exportPNG(): Promise<void> {
  return withBusy(async () => {
    const r = await exportJob<Preview>("path");
    const dpi = 300;
    const pxPerMm = dpi / 25.4;
    const marginMm = 2;
    const w = Math.ceil((r.bbox.w / r.u + marginMm * 2) * pxPerMm);
    const h = Math.ceil((r.bbox.h / r.u + marginMm * 2) * pxPerMm);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    const k = pxPerMm / r.u;
    ctx.setTransform(k, 0, 0, k, (marginMm * r.u - r.bbox.x) * k, (marginMm * r.u - r.bbox.y) * k);
    ctx.fillStyle = "#000000";
    ctx.fill(new Path2D(r.d), "evenodd");
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("PNG");
    await deliver(`${fileBase()}.png`, blob, "image/png");
  });
}

function copySVG(): void {
  const mode = view === "cut" ? "svg-cut" : "svg-fill";
  // start the clipboard write inside the click, as browsers require
  const text = exportJob<{ data: string }>(mode).then((r) => r.data);
  const write =
    navigator.clipboard && typeof ClipboardItem !== "undefined"
      ? navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })])
      : text.then((t) => navigator.clipboard.writeText(t));
  write.then(
    () => note(S.copied),
    async () => {
      const ta = document.createElement("textarea");
      ta.readOnly = true;
      ta.value = await text;
      note(S.copyBlocked, ta);
      ta.select();
    },
  );
}

// ------------------------------------------------------------ controls
const RANGE_KEYS = ["widthMm", "lineMm", "borderMm", "ringMm", "kerfMm", "minFeatureMm", "holeMm"] as const;
const SCENE_KEYS = ["trees", "wind", "waves"] as const;
const input = (id: string) => $<HTMLInputElement>(id);

function syncControls(): void {
  const f = (v: number, d: number) => formatNumber(lang, v, d);
  if (document.activeElement !== input("seed")) input("seed").value = params.seed;
  input(`paw-${params.paw}`).checked = true;
  for (const k of RANGE_KEYS) input(k).value = String(params[k]);
  for (const k of SCENE_KEYS) input(k).value = String(params.scene[k]);
  input("branches").checked = params.scene.branches;
  input("web").checked = params.web;
  input("hole").checked = params.hole;
  if (document.activeElement !== input("name-text")) input("name-text").value = params.name.text;
  input(`font-${params.name.font}`).checked = true;
  $("widthMm-out").textContent = `${params.widthMm} mm`;
  $("lineMm-out").textContent = `${f(params.lineMm, 2)} mm`;
  $("borderMm-out").textContent = `${f(params.borderMm, 1)} mm`;
  $("ringMm-out").textContent = `${f(params.ringMm, 1)} mm`;
  $("kerfMm-out").textContent = `${f(params.kerfMm, 2)} mm`;
  $("minFeatureMm-out").textContent = `${f(params.minFeatureMm, 2)} mm`;
  $("holeMm-out").textContent = `${f(params.holeMm, 1)} mm`;
  $("trees-out").textContent = `${Math.round(params.scene.trees * 100)}%`;
  $("wind-out").textContent = String(params.scene.wind);
  $("waves-out").textContent = String(params.scene.waves);
  const main = params.main.motif;
  $("scene-group").hidden = !(main === "forest" || main === "mountains" || main === "name");
  $("name-fields").hidden = main !== "name";
  $("branch-field").hidden = main !== "forest";
  input("holeMm").disabled = !params.hole;
  $("hole-field").classList.toggle("disabled", !params.hole);
  ($("undo") as HTMLButtonElement).disabled = !past.length;
  ($("redo") as HTMLButtonElement).disabled = !future.length;
}

function applyLanguage(): void {
  S = STRINGS[lang];
  document.documentElement.lang = lang;
  input(`lang-${lang}`).checked = true;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n]"))) {
    const v = S[el.dataset.i18n as keyof Strings];
    if (typeof v === "string") el.textContent = v;
  }
  $("laser").textContent = laser ? S.stop : S.laser;
  for (const mat of MATERIALS) $(`material-${mat}-label`).textContent = S.materials[mat];
  drawPreview();
  drawPicker();
  schedulePalette();
  syncControls();
  scheduleThumbs();
}

function refresh(): void {
  storage.set(KEY, JSON.stringify(params));
  syncControls();
  drawPicker();
  void schedulePreview();
  schedulePalette();
  scheduleThumbs();
}

function wire(): void {
  const form = $("controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  input("seed").addEventListener("input", () => commit({ ...params, seed: input("seed").value }, "seed"));
  input("seed").addEventListener("blur", () => syncControls());
  $("dice").addEventListener("click", () => commit({ ...params, seed: randomSeed() }));
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="paw"]'))) el.addEventListener("change", () => commit({ ...params, paw: el.value }));
  for (const k of RANGE_KEYS) input(k).addEventListener("input", () => commit({ ...params, [k]: Number(input(k).value) }, k));
  for (const k of SCENE_KEYS) input(k).addEventListener("input", () => commit({ ...params, scene: { ...params.scene, [k]: Number(input(k).value) } }, k));
  input("branches").addEventListener("change", () => commit({ ...params, scene: { ...params.scene, branches: input("branches").checked } }));
  input("web").addEventListener("change", () => commit({ ...params, web: input("web").checked }));
  input("hole").addEventListener("change", () => commit({ ...params, hole: input("hole").checked }));
  input("name-text").addEventListener("input", () => commit({ ...params, name: { ...params.name, text: input("name-text").value } }, "name"));
  input("name-text").addEventListener("blur", () => syncControls());
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="font"]')))
    el.addEventListener("change", () => commit({ ...params, name: { ...params.name, font: el.value } }));
  $("reroll").addEventListener("click", () => {
    const cur = motifOf(params, selected);
    setPad(selected, cur.motif, cur.variant + 1);
  });
  $("apply-toes").addEventListener("click", () => {
    if (selected === MAIN_PAD) return;
    const cur = params.toes[selected]!;
    commit({ ...params, toes: params.toes.map((t, i) => ({ motif: cur.motif, variant: i === selected ? cur.variant : t.variant })) });
  });
  $("mix-toes").addEventListener("click", () => {
    const pool = TOE_MOTIFS.filter((m) => m !== "open" && m !== "solid");
    commit({ ...params, toes: params.toes.map(() => ({ motif: pool[Math.floor(Math.random() * pool.length)], variant: Math.floor(Math.random() * 50) })) });
  });
  $("reset").addEventListener("click", () => commit(DEFAULTS));
  $("more").addEventListener("click", () => {
    thumbSeeds = Array.from({ length: 6 }, randomSeed);
    void drawThumbs();
  });
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="view"]'))) el.addEventListener("change", () => setView(el.value as View));
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="material"]')))
    el.addEventListener("change", () => {
      material = el.value as Material;
      storage.set(`${KEY}:material`, material);
      drawPreview();
    });
  $("laser").addEventListener("click", startLaser);
  input("show-thin").addEventListener("change", () => {
    showThin = input("show-thin").checked;
    drawPreview();
  });
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="lang"]')))
    el.addEventListener("change", () => {
      lang = el.value as Lang;
      storage.set(`${KEY}:lang`, lang);
      applyLanguage();
    });
  $("save-svg-fill").addEventListener("click", () => void exportFile("svg-fill"));
  $("save-svg-cut").addEventListener("click", () => void exportFile("svg-cut"));
  $("save-pdf-fill").addEventListener("click", () => void exportFile("pdf-fill"));
  $("save-png").addEventListener("click", () => void exportPNG());
  $("copy").addEventListener("click", copySVG);
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (target.matches('input[type="text"], textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    }
  });
}

if (!Number.isInteger(selected) || selected < 0 || selected > MAIN_PAD) selected = 1;
wire();
(document.getElementById(`material-${material}`) as HTMLInputElement).checked = true;
setView(view);
applyLanguage();
refresh();
