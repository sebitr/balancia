import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentUser } from "@/lib/security/actor";
import { listGroupsForUser } from "@/modules/groups/service";

export const metadata: Metadata = { title: "Your groups" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  // The layout has already redirected when there is no user.
  const groups = user ? await listGroupsForUser(user.userId) : [];

  const active = groups.filter((group) => group.archivedAt === null);
  const archived = groups.filter((group) => group.archivedAt !== null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Your groups
          </h1>
          <p className="text-sm text-muted-foreground">
            {active.length === 0
              ? "Nothing here yet."
              : `${active.length} active ${active.length === 1 ? "group" : "groups"}`}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/groups/new">
            <Plus aria-hidden="true" />
            New group
          </Link>
        </Button>
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Create your first group"
          description="A group is a set of people sharing expenses — a trip, a flat, a project. Add expenses and Balancia works out who owes whom."
          action={
            <Button asChild>
              <Link href="/groups/new">
                <Plus aria-hidden="true" />
                Create a group
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {active.map((group) => (
            <li key={group.id}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="p-0">
                  <Link
                    href={`/groups/${group.id}`}
                    className="flex items-center justify-between gap-4 rounded-lg p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{group.name}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users aria-hidden="true" className="size-3.5" />
                          {group.participantCount}{" "}
                          {group.participantCount === 1 ? "person" : "people"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {group.currencyMode === "converted"
                            ? `Converted to ${group.baseCurrency}`
                            : "Separate currencies"}
                        </span>
                      </p>
                    </div>
                    {group.role === "owner" && (
                      <Badge variant="secondary" className="shrink-0">
                        Owner
                      </Badge>
                    )}
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Archive aria-hidden="true" className="size-4" />
            Archived
          </h2>
          <ul className="space-y-2">
            {archived.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}`}
                  className="block rounded-lg border px-4 py-3 text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="text-muted-foreground">{group.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
