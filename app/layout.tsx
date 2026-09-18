import type { Metadata, Viewport } from "next";
import { db } from "@/lib/db";
import { getCurrentUserOrNull } from "@/lib/auth";
import { destinationsFor } from "@/components/nav/destinations";
import { AppNav } from "@/components/nav/AppNav";
import { Masthead } from "@/components/nav/Masthead";
import { Banner } from "@/components/ui/primitives";
import { plexCondensed, plexMono, plexSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "QI Agent",
  description:
    "Institution-wide graduate medical education quality improvement: projects, statistical process control, and the committee's record.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#edf1f2",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserOrNull();
  const program = user?.programId
    ? await db.program.findUnique({ where: { id: user.programId } })
    : null;

  return (
    <html lang="en">
      <body
        className={`${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable} min-h-dvh antialiased`}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:border focus:border-primary focus:bg-paper focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>

        {user ? (
          <>
            <Masthead user={user} program={program} />
            <AppNav destinations={destinationsFor(user.role)} />
            {/* Bottom padding clears the fixed mobile nav. */}
            <main id="main" className="mx-auto max-w-6xl px-4 py-6 pb-28 md:px-6 md:pb-10">
              {children}
            </main>
          </>
        ) : (
          <main id="main" className="mx-auto max-w-2xl px-4 py-16">
            <Banner tone="signal" title="No user resolved">
              Set <code className="font-mono">DEV_USER_EMAIL</code> in your{" "}
              <code className="font-mono">.env</code> to a seeded address such as{" "}
              <code className="font-mono">chair@example.edu</code>, and run{" "}
              <code className="font-mono">pnpm db:seed</code>. For the production
              path, see <code className="font-mono">docs/SSO.md</code>.
            </Banner>
          </main>
        )}
      </body>
    </html>
  );
}
