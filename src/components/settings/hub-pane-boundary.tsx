"use client";

import { catchError } from "next/error";

/**
 * Holds the desk's hub pane apart from the screen beside it.
 *
 * The pane is drawn by the settings layout, and a layout has no `error.tsx` of
 * its own to fall back on: a failure there would climb past every settings
 * screen to the root's page of apology, on a phone as well as a desk — and on
 * a phone the pane is not even shown. Before the pane existed, a summary that
 * could not be read cost the hub and nothing else.
 *
 * So a pane that cannot be drawn is simply not drawn. The screen beside it
 * still works, the ✕ above both still closes, and Next.js has already logged
 * what went wrong on the server. On `/settings` the phone's hub reads the same
 * facts and fails into `error.tsx` the way it always did.
 */
function NoPane() {
  return null;
}

export const HubPaneBoundary = catchError(NoPane);
