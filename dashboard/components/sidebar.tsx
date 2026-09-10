"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Five primary nav items, no deeper nesting than two levels --
 * docs/04-ui-ux-design.md Section 2 (Information Architecture).
 */
const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/sessions", label: "Sessions" },
  { href: "/cost", label: "Cost" },
  { href: "/rules", label: "Rules" },
  { href: "/settings", label: "Settings" },
];

// docs/04-ui-ux-design.md never specifies where sign-out lives -- the
// sidebar footer is the conventional spot and keeps it reachable from
// every page without adding a new nav item.
export function Sidebar({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="sidebar" aria-label="Primary">
      <div className="sidebar-brand">GuardrunAgent</div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={isActive ? "sidebar-link active" : "sidebar-link"}
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="sidebar-footer">
        {userEmail && <div className="sidebar-user">{userEmail}</div>}
        <button type="button" className="sidebar-link sidebar-signout" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
