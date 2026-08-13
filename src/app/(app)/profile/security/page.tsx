import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PasskeyManager } from "@/components/auth/passkey-manager";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Passkeys & security" };

export default async function SecurityPage() {
  const env = getEnv();
  const isLocalhost =
    env.webAuthnRpId === "localhost" ||
    env.webAuthnRpId === "127.0.0.1" ||
    env.webAuthnRpId.endsWith(".localhost");
  const secureContext = env.appOrigin.startsWith("https://") || isLocalhost;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/profile">
            <ArrowLeft aria-hidden="true" />
            Back
          </Link>
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Passkeys &amp; security
        </h1>
        <p className="text-sm text-muted-foreground">
          A passkey lets you sign in with your device&apos;s own unlock —
          fingerprint, face or PIN — instead of typing a password.
        </p>
      </div>

      {!secureContext && (
        <Alert variant="destructive">
          <AlertDescription>
            Passkeys need HTTPS. This instance is served over plain HTTP from a
            non-localhost address, so your browser will refuse to create one.
            Put Balancia behind a TLS-terminating reverse proxy and set{" "}
            <code>APP_URL</code> to the https:// address.
          </AlertDescription>
        </Alert>
      )}

      <PasskeyManager
        relyingPartyId={env.webAuthnRpId}
        enabled={secureContext}
      />
    </div>
  );
}
