"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Saying the entry instead of typing it.
 *
 * One of the two ways in that skip the form, and the one that works while
 * somebody is holding a bag: "24 francs Coop" is a sentence, not four fields.
 * What is heard *proposes* — it fills the form and the reader confirms. A
 * wrong expense that saved itself is worse than no expense, because it is
 * wrong in the balances and nobody was watching.
 *
 * Renders nothing where the browser has no recogniser, which is most of them
 * outside Chrome and Safari. A button that explains why it cannot work is
 * worse than no button: this is a shortcut, and the ordinary path is right
 * there.
 *
 * The API is prefixed on every engine that has it and unspecified in TypeScript's
 * DOM library, so the shapes below are declared rather than imported. They are
 * the three fields this component actually reads.
 */

interface SpeechResultAlternative {
  readonly transcript: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<SpeechResultAlternative>>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

function recogniser(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Nothing ever changes whether a browser has a recogniser. */
function subscribeNever(): () => void {
  return () => {};
}

export function VoiceButton({
  onHeard,
  className,
}: {
  /** The whole transcript, once the recogniser has settled on one. */
  onHeard: (transcript: string) => void;
  className?: string;
}) {
  const t = useTranslations("addEntry.voice");
  const locale = useLocale();
  /*
   * Whether this browser can hear at all, read as external state rather than
   * discovered in an effect.
   *
   * It is exactly that: a fact about the platform, not something React owns.
   * The server snapshot is `false`, so the button is absent in the markup and
   * appears on hydration where it works — rather than being rendered and then
   * withdrawn, which is a control that flickers away as somebody reaches for
   * it. Nothing ever changes it, so the subscribe is a no-op.
   */
  const supported = useSyncExternalStore(
    subscribeNever,
    () => recogniser() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const active = useRef<SpeechRecognitionLike | null>(null);

  // Stop listening if the drawer closes mid-sentence.
  useEffect(
    () => () => {
      active.current?.stop();
      active.current = null;
    },
    [],
  );

  if (!supported) return null;

  const listen = () => {
    if (listening) {
      active.current?.stop();
      return;
    }
    const Recognition = recogniser();
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = locale;
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) onHeard(transcript);
    };
    // A failure is silence, not a message. Permission refused, no microphone,
    // nothing heard — in all three the reader is looking at a form they can
    // still type into, and an error would only tell them so.
    recognition.onerror = () => setListening(false);
    recognition.onend = () => {
      setListening(false);
      active.current = null;
    };

    active.current = recognition;
    setListening(true);
    recognition.start();
  };

  return (
    <button
      type="button"
      onClick={listen}
      aria-pressed={listening}
      aria-label={listening ? t("stop") : t("start")}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-xl border px-3 text-sm transition-colors",
        listening
          ? "border-primary bg-primary/15 font-semibold text-foreground"
          : "border-border bg-white/4 text-muted-foreground",
        className,
      )}
    >
      <Mic
        aria-hidden="true"
        className={cn("size-4 shrink-0", listening && "animate-pulse")}
      />
      <span className="truncate">
        {listening ? t("listening") : t("start")}
      </span>
    </button>
  );
}
