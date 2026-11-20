"use client";
import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { Prototype } from "@/lib/prototype-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PrototypeCard } from "@/components/prototype-card";
import { ThemeToggle } from "@/components/theme-toggle";
export function Gallery({ prototypes }: { prototypes: Prototype[] }) {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [hidden, setHidden] = useState(false);
  const tags = [...new Set(prototypes.flatMap((p) => p.tags))].sort();
  const filtered = prototypes.filter(
    (p) =>
      (hidden || !p.hidden) &&
      (!tag || p.tags.includes(tag)) &&
      `${p.title} ${p.description} ${p.tags.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <main className="mx-auto max-w-2xl px-5 pb-16">
      <header className="flex items-center justify-between border-b py-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          paidotopos<span className="text-primary">.</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            Personal playground
          </span>
          <ThemeToggle />
        </div>
      </header>
      <section className="pb-8 pt-14">
        <p className="eyebrow">A SPACE TO PLAY</p>
        <h1 className="mt-4 text-4xl font-medium tracking-tight sm:text-5xl">
          Small experiments.
          <br />
          <span className="text-muted-foreground">Open possibilities.</span>
        </h1>
        <p className="mt-5 text-muted-foreground">
          A collection of things made out of curiosity.
        </p>
      </section>
      <section aria-label="Filter prototypes" className="mb-8 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Search prototypes"
            placeholder="Find an experiment…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 pl-10"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={tag === "" ? "secondary" : "ghost"}
            className="min-h-11"
            onClick={() => setTag("")}
          >
            All
          </Button>
          {tags.map((t) => (
            <Button
              key={t}
              className="min-h-11"
              variant={tag === t ? "secondary" : "ghost"}
              onClick={() => setTag(tag === t ? "" : t)}
            >
              {t}
            </Button>
          ))}
          <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            Show hidden
          </label>
        </div>
      </section>
      <div className="mb-4 flex justify-between text-xs text-muted-foreground">
        <span>
          {filtered.length} experiment{filtered.length !== 1 ? "s" : ""}
        </span>
        <span>Recently updated</span>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {filtered.map((p) => (
          <PrototypeCard key={p.slug} prototype={p} />
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          No experiments found.
        </p>
      )}
      <footer className="mt-14 border-t pt-5 text-xs text-muted-foreground">
        Built for the joy of figuring things out.
      </footer>
    </main>
  );
}
