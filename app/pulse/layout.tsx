import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { PulseTabs } from "@/components/pulse/PulseTabs";

export default async function PulseLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <>
      <PulseTabs chair={user.role === "chair"} />
      {children}
    </>
  );
}
