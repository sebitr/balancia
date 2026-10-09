"use client";

import { useEffect, useState } from "react";
import { CloudRequestError, listCloudBackups, type CloudFile } from "./cloud";

export type CloudList =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly files: readonly CloudFile[] }
  | { readonly status: "failed"; readonly code: string | null };

const LOADING: CloudList = { status: "loading" };

/**
 * The backups at the person's destination, read once when the screen opens and
 * again when they ask.
 *
 * A listing is one request to the cloud through the server, so it is made when
 * the person is looking at it and not before, and a failure is something they
 * can retry from the list itself. `retry` bumps a counter that the request
 * depends on; the result remembers which attempt it answers, so a retry shows
 * "loading" straight away without the effect having to set any state before
 * its request is made.
 *
 * Pass null when there is no destination to list.
 */
export function useCloudBackups(destinationId: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    attempt: number;
    list: CloudList;
  } | null>(null);

  useEffect(() => {
    if (destinationId === null) return;
    const controller = new AbortController();
    listCloudBackups(destinationId, controller.signal).then(
      (files) => {
        if (controller.signal.aborted) return;
        setSettled({ attempt, list: { status: "ready", files } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({
          attempt,
          list: {
            status: "failed",
            code: error instanceof CloudRequestError ? error.code : null,
          },
        });
      },
    );
    return () => controller.abort();
  }, [destinationId, attempt]);

  const list: CloudList = settled?.attempt === attempt ? settled.list : LOADING;
  return { list, retry: () => setAttempt((count) => count + 1) };
}
