import type { ReactNode } from "react";
import { AreaMessages } from "@/i18n/area-messages";

/**
 * Hands the cloud backup screens their words.
 *
 * `cloudBackup` is a few hundred strings that only these screens read, so it
 * rides with them rather than with every page. See `client-messages.ts`.
 */
export default function BackupLayout({ children }: { children: ReactNode }) {
  return <AreaMessages area="backup">{children}</AreaMessages>;
}
