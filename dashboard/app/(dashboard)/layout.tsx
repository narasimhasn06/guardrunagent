import { redirect } from "next/navigation";

import { Sidebar } from "@/components/sidebar";
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

  return (
    <div className="dashboard-shell">
      <Sidebar />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
