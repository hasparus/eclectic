"use client";
import { ControlPanel, useControls } from "@/components/control-panel";
import { controls, defaults } from "./data";
import { PatternCanvas } from "./pattern-canvas";
export function OrbitStudy() {
  const { values, setValues, reset, randomize } = useControls(
    "orbit-study",
    defaults,
    controls,
  );
  return (
    <main className="mx-auto max-w-5xl px-5 pb-28 pt-6">
      <div className="mb-8 max-w-2xl">
        <p className="eyebrow">GENERATIVE / INTERACTIVE</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">
          Orbit study
        </h1>
        <p className="mt-3 text-muted-foreground">
          A small change in angle. A whole new pattern.
        </p>
      </div>
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <PatternCanvas settings={values} />
        </div>
        <ControlPanel
          schema={controls}
          values={values}
          onChange={setValues}
          onReset={reset}
          onRandomize={randomize}
        />
      </div>
    </main>
  );
}
