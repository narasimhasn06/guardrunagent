"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export function Sidebar() {
  const pathname = usePathname();

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
    </nav>
  );
}
