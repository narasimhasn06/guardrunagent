import { redirect } from "next/navigation";

import { CreateOrgForm } from "@/components/onboarding/create-org-form";
import { Sidebar } from "@/components/sidebar";
import { getMe } from "@/lib/backend";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defense in depth: proxy.ts already redirects unauthenticated requests
  // before they reach here, but its matcher can miss edge cases -- this
  // is the authoritative check for this layout.
  if (!user) {
    redirect("/login");
  }

  // Every page under here 403s for a signed-in user with no org (the
  // backend's verify_jwt requires one) -- checked here, before any of
  // them render, rather than letting each page hit that 403 on its own
  // first backend call the way Home used to (see docs comment above
  // MeOut in backend/app/schemas.py for why this gap existed at all).
  const me = await getMe();
  if (!me.has_org) {
    return (
      <div className="login-page">
        <CreateOrgForm />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <Sidebar userEmail={user.email} isPlatformAdmin={me.is_platform_admin} />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
