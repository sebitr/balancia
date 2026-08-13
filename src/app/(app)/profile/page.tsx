import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/security/actor";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await getCurrentUser();

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        Profile
      </h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Name</p>
            <p className="font-medium">{user?.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="font-medium">{user?.email}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Your name inside a group is set per group, so you can appear
            differently to different sets of people.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Security</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add a passkey to sign in with your device instead of a password.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/profile/security">
              <ShieldCheck aria-hidden="true" />
              Manage passkeys
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
