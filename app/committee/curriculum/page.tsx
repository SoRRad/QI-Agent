import { importCurriculumAction } from "@/app/committee/actions";
import { IMPORT_HEADERS } from "@/lib/committee/curriculum";
import { curriculumTracker } from "@/lib/committee/services/curriculum";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { ActionForm, Field, inputClass } from "@/components/projects/ActionForm";
import { EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Curriculum" };

const short = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });

export default async function CurriculumPage() {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  if (user.role !== "chair") return <Restricted chairOnly />;
  const t = await curriculumTracker(user);

  return (
    <>
      <CommitteeHeader
        user={user}
        current="curriculum"
        title="Curriculum"
        lede="Completion of the QI curriculum by program and by trainee. The export uses the same columns as the import, so it can be edited and imported back, and serves ACGME reporting."
        action={
          <a
            href="/api/committee/curriculum"
            className="inline-flex min-h-11 items-center justify-center border border-grid bg-surface px-4 text-sm font-medium text-ink hover:border-muted"
          >
            Export CSV
          </a>
        }
      />
      <div className="flex flex-col gap-4">
        <PlotFrame label="By program">
          {t.programs.length === 0 ? (
            <EmptyState title="No trainees">Active trainees appear here with their completion.</EmptyState>
          ) : (
            <table className="w-full text-left text-sm" data-testid="curriculum-programs">
              <caption className="sr-only">Curriculum completion by program</caption>
              <thead className="font-mono text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-normal">
                    Program
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-normal">
                    Trainees
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-normal">
                    Completed
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grid">
                {t.programs.map((p) => (
                  <tr key={p.program}>
                    <th scope="row" className="py-1.5 pr-2 font-normal text-ink">
                      {p.program}
                    </th>
                    <td className="py-1.5 pr-2 text-right font-mono" data-numeric="">
                      {p.trainees}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono" data-numeric="">
                      {p.completed} of {p.possible}
                    </td>
                    <td className="py-1.5 text-right font-mono" data-numeric="">
                      {p.percent === null ? "—" : `${p.percent}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Possible = active trainees × the {t.items.length} items in the tracker. A trainee with no record for an item has not completed it.
          </p>
        </PlotFrame>

        <PlotFrame label={`By trainee · ${t.trainees.length}`}>
          <ul className="divide-y divide-grid" data-testid="curriculum-trainees">
            {t.trainees.map((row) => (
              <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-sm font-medium text-ink">{row.name}</p>
                  <span className="shrink-0 font-mono text-xs text-muted" data-numeric="">
                    {row.completed} of {t.items.length}
                  </span>
                </div>
                <p className="font-mono text-xs text-muted">{row.program}</p>
                <ul className="mt-1.5 flex flex-col gap-0.5 text-xs">
                  {t.items.map((item) => {
                    const at = row.completedAt[item];
                    return (
                      <li key={item} className="flex justify-between gap-3">
                        <span className={at ? "text-ink" : "text-muted"}>
                          <span aria-hidden="true">{at ? "✓ " : "○ "}</span>
                          {item}
                          <span className="sr-only">{at ? ": completed" : ": not completed"}</span>
                        </span>
                        {at && <span className="shrink-0 font-mono text-muted">{short(at)}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </PlotFrame>

        <PlotFrame label="Import">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            A CSV with the columns <code className="font-mono">{IMPORT_HEADERS.join(", ")}</code>. Dates are written YYYY-MM-DD; a blank date assigns the item without completing
            it. The whole file is refused if any row is wrong, with every problem listed. An import never clears a completion already on record.
          </p>
          <ActionForm action={importCurriculumAction} hidden={{}} submitLabel="Import" pendingLabel="Importing…">
            <Field id="curriculum-file" label="CSV file">
              <input id="curriculum-file" name="file" type="file" accept=".csv,text/csv" required className={`${inputClass} py-2`} />
            </Field>
          </ActionForm>
        </PlotFrame>
      </div>
    </>
  );
}
