"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SlidersHorizontal } from "lucide-react";
export type Control<T> = {
  key: keyof T & string;
  label: string;
  min: number;
  max: number;
  step: number;
};
export function useControls<T extends Record<string, number>>(
  namespace: string,
  defaults: T,
  controls: Control<T>[],
) {
  const [values, setValues] = useState<T>(defaults),
    [loaded, setLoaded] = useState(false);
  // Hydrate persisted settings after mount; server rendering must use defaults.
  /* eslint-disable react-hooks/set-state-in-effect -- Hydrate browser storage after mount. */
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(`paidotopos:${namespace}:controls`) || "null",
      );
      if (saved)
        setValues(
          Object.fromEntries(
            controls.map((c) => [
              c.key,
              typeof saved[c.key] === "number" && Number.isFinite(saved[c.key])
                ? Math.max(c.min, Math.min(c.max, saved[c.key]))
                : defaults[c.key],
            ]),
          ) as T,
        );
    } catch {}
    setLoaded(true);
  }, [namespace, defaults, controls]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(
          `paidotopos:${namespace}:controls`,
          JSON.stringify(values),
        );
      } catch {}
  }, [values, loaded, namespace]);
  return {
    values,
    setValues,
    reset: () => setValues({ ...defaults }),
    randomize: () =>
      setValues(
        Object.fromEntries(
          controls.map((c) => [
            c.key,
            Math.round((c.min + Math.random() * (c.max - c.min)) / c.step) *
              c.step,
          ]),
        ) as T,
      ),
  };
}
export function ControlPanel<T extends Record<string, number>>({
  schema,
  values,
  onChange,
  onReset,
  onRandomize,
}: {
  schema: Control<T>[];
  values: T;
  onChange: (v: T) => void;
  onReset: () => void;
  onRandomize: () => void;
}) {
  const contents = (
    <div className="space-y-6">
      {schema.map((c) => (
        <label key={c.key} className="block text-sm">
          <span className="flex justify-between gap-3">
            <span>{c.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {values[c.key]}
            </span>
          </span>
          <input
            className="mt-2 min-h-11 w-full accent-primary"
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={values[c.key]}
            onChange={(e) =>
              onChange({ ...values, [c.key]: Number(e.target.value) })
            }
          />
        </label>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" className="min-h-11 flex-1" onClick={onReset}>
          Reset
        </Button>
        <Button className="min-h-11 flex-1" onClick={onRandomize}>
          Randomize
        </Button>
      </div>
    </div>
  );
  return (
    <>
      <aside className="hidden w-64 shrink-0 self-start rounded-xl border bg-card p-5 md:block">
        <h2 className="mb-6 text-sm font-medium">Parameters</h2>
        {contents}
      </aside>
      <div className="fixed inset-x-0 bottom-0 border-t bg-background p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button className="min-h-11 w-full" variant="secondary">
              <SlidersHorizontal />
              <span className="sr-only sm:not-sr-only">Parameters</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] overflow-y-auto rounded-t-xl p-5"
          >
            <SheetHeader className="px-0">
              <SheetTitle>Parameters</SheetTitle>
            </SheetHeader>
            {contents}
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
