"use client";

import { useEffect, useRef, useState } from "react";
import { UNDO_WINDOW } from "@/components/ui/sonner";

/** How long typing has to stop before what was typed is sent. */
const QUIET = 800;

/** When a change reaches the server. */
export type Timing =
  /** After a pause, or when the field is left: anything typed into. */
  | "typed"
  /** At once: a switch, or something picked from a list. */
  | "chosen"
  /** Not yet: what a sheet is still deciding, until it closes. */
  | "held";

export interface Autosave<T> {
  /** What the fields read. */
  readonly draft: T;
  /** Whether a write is in the air, for a hint beside the heading. */
  readonly saving: boolean;
  readonly edit: (changes: Partial<T>, when?: Timing) => void;
  /** Sends what is pending now — a field being left, a sheet closing. */
  readonly flush: () => void;
}

/**
 * A card that writes itself as it is edited, and can be told to stop.
 *
 * The pattern is the same wherever settings are: typing waits for a pause,
 * choosing does not, a sheet holds its choices until it closes, and every
 * write offers a way back. What differs between screens is only the copy, the
 * shape being written and where it goes — so those are handed in, and the
 * awkward parts live here once.
 *
 * The awkward parts are three. **Order**: writes queue behind one another and
 * the newest draft is sent after whatever was in the air, so a fast typist
 * cannot land an old value on top of a new one. **The way back**: a run of
 * edits is one thing to undo, so the baseline is taken at the first write of a
 * run and stands until the toast offering it has had its eight seconds —
 * undoing therefore returns to what the run began with rather than to the
 * keystroke before last. **Leaving**: whatever is still pending goes on
 * unmount, because typing and then closing the row is not a change anybody
 * meant to throw away.
 *
 * A failed write is not retried on its own: the next edit is the retry, and
 * until then the fields still show what was typed. `ready` is the other way
 * nothing is sent — a name that is empty, an address half typed — and the
 * screen says so beside the field rather than in a toast the reader did not
 * ask for.
 *
 * The draft is held twice, as state for the fields and as a ref for a write
 * that started a keystroke ago. `persisted` is what the server is known to
 * hold; it moves forward on a write rather than waiting for the refresh to
 * bring the new record back.
 */
export function useAutosave<T extends object>({
  initial,
  same,
  ready,
  write,
  announce,
  settled,
  quietMs = QUIET,
}: {
  /** Read once, on mount: what is stored now. */
  initial: T;
  same: (a: T, b: T) => boolean;
  /** Nothing is written while this says no. Absent means always ready. */
  ready?: (draft: T) => boolean;
  /** Writes the draft and answers whether it stuck; saying so is the caller's. */
  write: (draft: T) => Promise<boolean>;
  /** Raised after a write, with the way back to what the run began with. */
  announce: (undo: () => void) => void;
  /** Once at the end of a run, for the refresh the screen needs. */
  settled?: () => void;
  quietMs?: number;
}): Autosave<T> {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  const draftNow = useRef(initial);
  const persisted = useRef(initial);
  const inFlight = useRef(false);
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What Undo would put back, and the timer that forgets it once the toast
  // offering it has gone.
  const undoTo = useRef<T | null>(null);
  const forget = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The newest render's callbacks, for a write that started a keystroke ago.
  const handlers = useRef({ same, ready, write, announce, settled });
  useEffect(() => {
    handlers.current = { same, ready, write, announce, settled };
  });

  const clear = (
    timer: React.RefObject<ReturnType<typeof setTimeout> | null>,
  ) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const save = async (announceIt = true): Promise<void> => {
    if (inFlight.current) return;
    const current = handlers.current;
    const next = draftNow.current;
    const before = persisted.current;
    if (current.same(next, before)) return;
    if (current.ready && !current.ready(next)) return;

    inFlight.current = true;
    setSaving(true);
    try {
      if (!(await current.write(next))) return;
      persisted.current = next;
      if (announceIt) {
        undoTo.current ??= before;
        const back = undoTo.current;
        clear(forget);
        forget.current = setTimeout(() => {
          undoTo.current = null;
        }, UNDO_WINDOW);
        current.announce(() => restore(back));
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }

    if (!current.same(draftNow.current, persisted.current)) {
      await save();
      return;
    }
    current.settled?.();
  };

  /** Puts a whole run back, and writes that without announcing it. */
  const restore = (back: T) => {
    undoTo.current = null;
    clear(forget);
    clear(quiet);
    draftNow.current = back;
    setDraft(back);
    void save(false);
  };

  const edit = (changes: Partial<T>, when: Timing = "typed") => {
    const next = { ...draftNow.current, ...changes };
    draftNow.current = next;
    setDraft(next);

    clear(quiet);
    if (when === "held") return;
    if (when === "chosen") {
      void save();
      return;
    }
    quiet.current = setTimeout(() => void save(), quietMs);
  };

  const flush = () => {
    clear(quiet);
    void save();
  };

  // The newest `save`, for a cleanup that must not close over a stale draft.
  const latest = useRef(save);
  useEffect(() => {
    latest.current = save;
  });

  useEffect(
    () => () => {
      clear(quiet);
      clear(forget);
      // Typing and then leaving is still a change: it goes with them.
      void latest.current();
    },
    [],
  );

  return { draft, saving, edit, flush };
}
