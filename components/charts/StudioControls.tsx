import Link from "next/link";
import { cx } from "@/components/ui/primitives";
import { CHART_NAMES } from "@/lib/charts/describe";
import { studioQuery, type BaselineChoice, type StudioParams } from "@/lib/charts/studio";
import type { ChartKind } from "@/lib/spc";

/**
 * The studio's controls, as links. Every state of the chart has a URL, the
 * page works before JavaScript loads, and the browser's back button undoes a
 * change.
 */
export function StudioControls({
  basePath,
  chartType,
  params,
  baselines,
}: {
  basePath: string;
  chartType: ChartKind;
  params: StudioParams;
  baselines: BaselineChoice[];
}) {
  const href = (next: Partial<StudioParams>) => `${basePath}${studioQuery({ ...params, ...next })}`;

  return (
    <div className="flex flex-col gap-3">
      {chartType !== "run" && (
        <Segmented
          label="Chart"
          items={[
            { href: href({ view: "run", westernElectric: false }), label: "Run chart", current: params.view === "run" },
            { href: href({ view: "control" }), label: `${CHART_NAMES[chartType]} (control)`, current: params.view === "control" },
          ]}
        />
      )}

      {baselines.length > 0 && (
        <Segmented
          label="Centre line from"
          stack
          items={[
            { href: href({ baseline: null }), label: "Whole series", current: params.baseline === null },
            ...baselines.map((b) => ({
              href: href({ baseline: b.length }),
              label: `Before change ${b.annotationNumber} · first ${b.length} points`,
              title: `Freeze the centre line${params.view === "control" ? " and limits" : ""} at the ${b.length} points before “${b.label}”`,
              current: params.baseline === b.length,
            })),
          ]}
        />
      )}

      {params.view === "control" && (
        <div>
          <Segmented
            label="Western Electric rules"
            items={[
              { href: href({ westernElectric: false }), label: "Off", current: !params.westernElectric },
              { href: href({ westernElectric: true }), label: "On", current: params.westernElectric },
            ]}
          />
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Extra pattern tests, such as eight points in a row on one side of the mean. Off by default: on the short
            series QI projects produce, applying them all raises false alarms.
          </p>
        </div>
      )}
    </div>
  );
}

function Segmented({
  label,
  items,
  stack = false,
}: {
  label: string;
  items: Array<{ href: string; label: string; current: boolean; title?: string }>;
  /** Stack vertically on narrow screens, for options too long to sit side by side. */
  stack?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="eyebrow shrink-0 sm:w-40">{label}</span>
      <ul className={cx("border border-grid bg-surface", stack ? "flex flex-col sm:flex-row sm:flex-wrap" : "flex flex-wrap")} aria-label={label}>
        {items.map((item) => (
          <li
            key={item.href}
            className={cx(
              "border-grid",
              stack ? "border-b last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0" : "border-r last:border-r-0",
            )}
          >
            <Link
              href={item.href}
              scroll={false}
              title={item.title}
              aria-current={item.current ? "true" : undefined}
              className={cx(
                "flex min-h-11 items-center px-3 text-xs font-medium sm:text-sm",
                item.current ? "bg-primary text-white" : "text-primary hover:bg-surface-sunken",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
