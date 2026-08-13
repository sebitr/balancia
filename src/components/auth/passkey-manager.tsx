"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  fetchPasskeys,
  registerPasskey,
  removePasskey,
  type PasskeyRecord,
} from "@/modules/auth/passkey-client";
import { usePasskeySupport } from "./use-passkey-support";

/**
 * Passkey enrolment and management.
 *
 * TanStack Query rather than a Server Component because the list changes in
 * response to a browser-only WebAuthn ceremony: registering has to happen
 * client-side, and the list must refresh immediately afterwards without a
 * full navigation.
 */
export function PasskeyManager({
  relyingPartyId,
  enabled,
}: {
  relyingPartyId: string;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [registering, setRegistering] = useState(false);
  const browserSupported = usePasskeySupport();

  const { data, isLoading, error } = useQuery({
    queryKey: ["passkeys"],
    queryFn: fetchPasskeys,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
  }, [queryClient]);

  const canRegister = enabled && browserSupported;

  const onRegister = async () => {
    setRegistering(true);
    try {
      await registerPasskey(name.trim() || undefined);
      toast.success("Passkey added");
      setName("");
      refresh();
    } catch (registerError) {
      const message =
        registerError instanceof Error &&
        registerError.name === "NotAllowedError"
          ? "The request was cancelled."
          : registerError instanceof Error
            ? registerError.message
            : "That passkey could not be registered.";
      toast.error(message);
    } finally {
      setRegistering(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await removePasskey(id);
      toast.success("Passkey removed");
      refresh();
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "That passkey could not be removed.",
      );
    }
  };

  return (
    <div className="space-y-4">
      {!browserSupported && (
        <Alert>
          <AlertDescription>
            This browser does not support passkeys. You can still sign in with
            your password.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add a passkey</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="passkey-name">
              Name{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="passkey-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Work laptop"
              maxLength={80}
              disabled={!canRegister}
            />
            <p className="text-xs text-muted-foreground">
              Registered for <code>{relyingPartyId}</code>. It will only work on
              this domain.
            </p>
          </div>
          <Button
            onClick={() => void onRegister()}
            disabled={!canRegister || registering}
          >
            {registering ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            Register a passkey
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your passkeys</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Loading…
            </p>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>
                Your passkeys could not be loaded. Refresh the page to try
                again.
              </AlertDescription>
            </Alert>
          ) : !data || data.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="No passkeys yet"
              description="Register one above to sign in without a password."
              className="border-0 py-6"
            />
          ) : (
            <ul className="divide-y">
              {data.map((passkey: PasskeyRecord) => (
                <li
                  key={passkey.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {passkey.name || "Unnamed passkey"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Added {new Date(passkey.createdAt).toLocaleDateString()}
                      {passkey.lastUsedAt &&
                        ` · last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}`}
                      {passkey.backedUp && " · synced"}
                    </span>
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${passkey.name || "this passkey"}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Remove this passkey?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          You will no longer be able to sign in with it. Make
                          sure you still have your password or another passkey.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(event) => {
                            event.preventDefault();
                            void onDelete(passkey.id);
                          }}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
