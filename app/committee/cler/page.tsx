import Link from "next/link";
import { createClerMockAction } from "@/app/committee/actions";
import { listClerMocks } from "@/lib/committee/services/cler";
import { CommitteeHeader, committeeUser, Restricted } from "@/components/committee/CommitteeShell";
import { ActionForm, Field, inputClass } from "@/components/projects/ActionForm";
import { Badge, EmptyState, PlotFrame } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "CLER mock" };

const day = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export default async function ClerPage() {
  const user = await committeeUser();
  if (!user) return <Restricted />;
  const mocks = await listClerMocks(user);

  return (
    <>
      <CommitteeHeader
        user={user}
        current="cler"
        title="Mock CLER walkaround"
        lede="Interviewer questions across the six CLER focus areas. Record each answer by the respondent's role, never their name, and rate it; the gap reading is counted from your ratings."
      />
      <div className="flex flex-col gap-4">
        <PlotFrame label={`${mocks.length} walkarounds`}>
          {mocks.length === 0 ? (
            <EmptyState title="No walkarounds yet">The chair sets one up below.</EmptyState>
          ) : (
            <ul className="divide-y divide-grid">
              {mocks.map((m) => (
                <li key={m.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link href={`/committee/cler/${m.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                      {m.title ?? "Mock walkaround"}
                    </Link>
                    {m.gaps > 0 && (
                      <Badge tone="signal">
                        {m.gaps} gap{m.gaps === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-xs text-muted" data-numeric="">
                    {day(m.date)} · {m.asked} questions
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PlotFrame>
        {user.role === "chair" && (
          <PlotFrame label="New walkaround">
            <ActionForm action={createClerMockAction} hidden={{}} submitLabel="Draft the questions" pendingLabel="Drafting…" phiFields={[["title", "Title"]]}>
              <Field id="cler-title" label="Title">
                <input id="cler-title" name="title" required minLength={4} maxLength={140} className={inputClass} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="cler-setting" label="Where" help={'For example, "medicine wards" or "the surgical ICU".'}>
                  <input id="cler-setting" name="setting" required minLength={3} maxLength={120} className={inputClass} aria-describedby="cler-setting-help" />
                </Field>
                <Field id="cler-date" label="Date">
                  <input id="cler-date" name="date" type="date" required className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </PlotFrame>
        )}
      </div>
    </>
  );
}
