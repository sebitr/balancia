import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/security/actor";
import { isInstanceAdmin } from "@/lib/security/admin";

/**
 * Layout for pages that require a signed-in *user* (not a guest). Guests live
 * under /groups/[groupId], which authorizes them separately.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }

  return (
    <AppShell
      actor={{
        label: user.name,
        email: user.email,
        isGuest: false,
        isAdmin: await isInstanceAdmin(user.userId),
      }}
    >
      {children}
    </AppShell>
  );
}
