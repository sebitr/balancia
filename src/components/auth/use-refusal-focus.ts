"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

/**
 * Puts the caret back in a form the server has just refused.
 *
 * Every one of these forms disables what was pressed while the request is
 * out — the submit button, or on the onboarding screen the field itself — and
 * a focused control that becomes disabled lets go of focus, which the browser
 * hands to the page. So a wrong password left a keyboard on nothing: the
 * message announced, both fields still filled in, and Tab starting again from
 * the top of the page to find the field it had just left.
 *
 * The caret goes to the field the reader has to type into next — the one the
 * refusal is about, which each form decides — with what is already in it
 * selected, so typing replaces it and Enter sends the same thing again.
 *
 * It moves in an effect, after the commit that put the refusal on screen,
 * never in the same breath as setting it. The message has to be in the
 * document before focus lands, or the field is announced and the reason it
 * was refused is not. The field the caret went to is returned too, so the
 * form can name the message as that field's description: a screen reader that
 * stops reading the alert to announce the newly focused field still reads the
 * reason, as part of the field.
 */
export function useRefusalFocus<Field extends string>(
  focus: (field: Field) => void,
): readonly [Field | null, (field: Field | null) => void] {
  // An object rather than the bare name, so that a second refusal about the
  // same field is a new value and moves the caret again — two wrong passwords
  // in a row are the ordinary case, not the exception.
  const [refusal, setRefusal] = useState<{ readonly field: Field } | null>(
    null,
  );
  const move = useEffectEvent((field: Field) => focus(field));

  useEffect(() => {
    if (refusal) move(refusal.field);
  }, [refusal]);

  /** A field to send the caret to, or null as a new attempt starts. */
  const refuse = useCallback(
    (field: Field | null) => setRefusal(field === null ? null : { field }),
    [],
  );

  return [refusal?.field ?? null, refuse] as const;
}

/**
 * The ids a field is described by, leaving out the ones not on screen.
 *
 * `aria-describedby` naming an element that is not there is an error to an
 * accessibility checker and noise to nobody else, so absent ids are dropped
 * rather than written out empty.
 */
export function describedBy(
  ...ids: readonly (string | false | null | undefined)[]
): string | undefined {
  const present = ids.filter((id): id is string => Boolean(id));
  return present.length > 0 ? present.join(" ") : undefined;
}
