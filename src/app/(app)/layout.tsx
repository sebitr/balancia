import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { readSidebarCollapsed } from "@/components/layout/sidebar-cookie";
import { getCurrentUser } from "@/lib/security/actor";

/**
 * Layout for pages that require a signed-in *user* (not a guest). Guests live
 * under /groups/[groupId], which authorizes them separately.
 *
 * Home, Notifications and the rest get the desktop sidebar like a group does,
 * with no group lit and Add asking which group first; see `AppShell`.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }

  return (
    <AppShell
      actor={{ label: user.name, isGuest: false }}
      sidebarCollapsed={await readSidebarCollapsed()}
    >
      {children}
    </AppShell>
  );
}
