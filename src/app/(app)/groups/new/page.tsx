import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateGroupForm } from "@/components/groups/create-group-form";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/security/actor";

export const metadata: Metadata = { title: "New group" };

export default async function NewGroupPage() {
  const user = await getCurrentUser();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/dashboard">
            <ArrowLeft aria-hidden="true" />
            Back
          </Link>
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Create a group
        </h1>
      </div>

      <CreateGroupForm defaultName={user?.name ?? ""} defaultTimezone="UTC" />
    </div>
  );
}
