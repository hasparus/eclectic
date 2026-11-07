import { run, type Job } from "../worker";

declare const __WORKER_SOURCE__: string;
// replaced at build time by the bundled worker

type Pending = { channel: string; priority: number; job: Job; resolve: (v: unknown) => void; reject: (e: unknown) => void };

/** Thrown to callers whose job was replaced by a newer one on the same channel. */
export class Superseded extends Error {
  constructor() {
    super("superseded");
  }
}

/**
 * Runs generator jobs in a worker, one at a time. Each job has a channel; a
 * new job on a channel replaces any queued one there, so dragging a slider
 * never builds a backlog. Lower priority numbers run first.
 */
export class Engine {
  private worker: Worker | null = null;
  private queue: Pending[] = [];
  private active: (Pending & { id: number }) | null = null;
  private nextId = 1;

  constructor() {
    try {
      const url = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: "text/javascript" }));
      this.worker = new Worker(url);
      this.worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
        const a = this.active;
        if (!a || a.id !== e.data.id) return;
        this.active = null;
        if (e.data.ok) a.resolve(e.data.result);
        else a.reject(new Error(e.data.error));
        this.pump();
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        this.worker = null;
        const a = this.active;
        this.active = null;
        if (a) this.queue.unshift(a);
        this.pump();
      };
    } catch {
      this.worker = null;
    }
  }

  get usesWorker(): boolean {
    return this.worker !== null;
  }

  request<T>(channel: string, job: Job, priority = 1): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue = this.queue.filter((q) => {
        if (q.channel !== channel) return true;
        q.reject(new Superseded());
        return false;
      });
      this.queue.push({ channel, priority, job, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  /** Drops queued jobs whose channel starts with `prefix`. */
  cancel(prefix: string): void {
    this.queue = this.queue.filter((q) => {
      if (!q.channel.startsWith(prefix)) return true;
      q.reject(new Superseded());
      return false;
    });
  }

  private pump(): void {
    if (this.active || !this.queue.length) return;
    this.queue.sort((a, b) => a.priority - b.priority);
    const next = this.queue.shift()!;
    const active = { ...next, id: this.nextId++ };
    this.active = active;
    if (this.worker) {
      this.worker.postMessage({ id: active.id, job: next.job });
      return;
    }
    // no worker (blocked or crashed): run on the main thread, yielding first
    setTimeout(() => {
      try {
        active.resolve(run(next.job));
      } catch (e) {
        active.reject(e);
      }
      this.active = null;
      this.pump();
    }, 0);
  }
}
