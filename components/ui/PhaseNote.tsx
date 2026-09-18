import { Eyebrow } from "./primitives";

/**
 * Marks scaffolding honestly. Phase 0 builds the shell and the data layer;
 * these notes say which phase builds the feature, so a demo never implies
 * something works when it does not.
 */
export function PhaseNote({ phase, children }: { phase: string; children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-grid bg-surface/60 px-4 py-3">
      <Eyebrow>Phase {phase}</Eyebrow>
      <p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}
