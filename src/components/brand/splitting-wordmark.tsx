"use client";

import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/brand/wordmark";

/**
 * The last share starts 140ms late and runs for 1000ms. Clearing the flag any
 * earlier cuts it off while it is still fading, and it blinks out.
 */
const SPLIT_MS = 1150;

/**
 * The header wordmark, which splits the bill when a pointer comes over it: the
 * dot shrinks away, three shares fall past the rule into the pan, the pan dips
 * to catch them and the dot re-forms. The product in one second.
 *
 * It runs once per hover-in and always to the end — leaving early does not cut
 * it short, and coming back while it runs does not restart it. Only a mouse or
 * a pen starts it: a tap on a phone is a navigation, and the animation would
 * be playing on the page being left. The keyframes are in `globals.css`,
 * under `prefers-reduced-motion: no-preference`, so a reader who asked for
 * less motion sees the mark hold still.
 */
export function SplittingWordmark(
  props: Omit<React.ComponentProps<typeof Wordmark>, "shares">,
) {
  const [splitting, setSplitting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Wordmark
      {...props}
      shares
      data-splitting={splitting || undefined}
      onPointerEnter={(event) => {
        props.onPointerEnter?.(event);
        if (event.pointerType === "touch" || timer.current) return;
        setSplitting(true);
        timer.current = setTimeout(() => {
          timer.current = null;
          setSplitting(false);
        }, SPLIT_MS);
      }}
    />
  );
}
