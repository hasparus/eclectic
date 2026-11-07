/// <reference lib="webworker" />
import { generate, pathData, toPDF, toSVG, type GenerateOptions } from "./index";

export type Job =
  | { kind: "preview"; params: unknown; opts: GenerateOptions }
  | { kind: "crop"; params: unknown; opts: GenerateOptions }
  | { kind: "export"; params: unknown; opts: GenerateOptions; format: "svg-fill" | "svg-cut" | "pdf-fill" | "pdf-cut" | "path" };

export function run(job: Job) {
  const r = generate(job.params, job.opts);
  if (job.kind === "crop") return { d: pathData(r.loops) };
  if (job.kind === "preview" || job.format === "path") {
    return { d: pathData(r.loops), bbox: r.bbox, u: r.unitsPerMm, stats: r.stats, pads: r.pads, hole: r.hole, thinSpots: r.thinSpots, params: r.params };
  }
  const [type, mode] = job.format.split("-") as ["svg" | "pdf", "fill" | "cut"];
  return { data: type === "svg" ? toSVG(r, { mode }) : toPDF(r, { mode }), stats: r.stats };
}

declare const self: DedicatedWorkerGlobalScope;
if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof window === "undefined") {
  self.onmessage = (e: MessageEvent<{ id: number; job: Job }>) => {
    const { id, job } = e.data;
    try {
      self.postMessage({ id, ok: true, result: run(job) });
    } catch (err) {
      self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
