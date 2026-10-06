"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_COLLAPSED,
  SIDEBAR_COOKIE_MAX_AGE,
  SIDEBAR_COOKIE_NAME,
} from "./sidebar-state";

/**
 * The desktop sidebar's one piece of state — expanded or folded to its icons —
 * and the frame that carries it.
 *
 * The frame is the shell's outermost box, and it states the choice as
 * `data-sidebar`, so everything that has to start where the sidebar stops can
 * read the width from CSS rather than from React: the shell's own grid, the
 * position strip, the docked actions under an entry. They all use
 * `--app-sidebar-w`, which `globals.css` points at the collapsed width under
 * `[data-sidebar="collapsed"]`. Below `lg` there is no sidebar to be narrow,
 * and nothing reads it.
 */

interface SidebarState {
  readonly collapsed: boolean;
  readonly setCollapsed: (collapsed: boolean) => void;
}

const SidebarContext = createContext<SidebarState | null>(null);

const EXPANDED: SidebarState = { collapsed: false, setCollapsed: () => {} };

/**
 * The sidebar's state, or the expanded default outside a frame — a group row
 * drawn in the phone's switcher has no sidebar to be folded into.
 */
export function useSidebar(): SidebarState {
  return useContext(SidebarContext) ?? EXPANDED;
}

/** Written by the browser; see `sidebar-state.ts` for why a cookie. */
function rememberCollapsed(collapsed: boolean) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = collapsed
    ? `${SIDEBAR_COOKIE_NAME}=${SIDEBAR_COLLAPSED}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax${secure}`
    : `${SIDEBAR_COOKIE_NAME}=; path=/; max-age=0; samesite=lax${secure}`;
}

export function SidebarFrame({
  initialCollapsed,
  className,
  children,
}: {
  /** What the server read from this device's cookie. */
  initialCollapsed: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);

  // Saved the moment it is pressed, and in silence: the sidebar moving is the
  // confirmation, and the same control is still under the pointer to put it
  // back. See "A control that flicks back says it for itself" in AGENTS.md.
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    rememberCollapsed(next);
  }, []);

  const value = useMemo(
    () => ({ collapsed, setCollapsed }),
    [collapsed, setCollapsed],
  );

  return (
    <SidebarContext value={value}>
      {/* The folded sidebar names every icon in a tip; one provider for all
          of them, so moving along the column does not wait out the delay
          again at each stop. */}
      <TooltipProvider delayDuration={200}>
        <div
          data-slot="app-frame"
          data-sidebar={collapsed ? "collapsed" : "expanded"}
          className={className}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext>
  );
}

/**
 * A tip beside a sidebar control, shown only while the sidebar is folded —
 * when the control has lost its words and the tip is where they went.
 *
 * Always mounted, and held shut while the sidebar is open, rather than added
 * and removed: wrapping a control in a tooltip changes the tree above it, and
 * React would remount the very button that was pressed to fold the sidebar,
 * taking the keyboard's focus with it.
 *
 * `card` draws it on the popover surface rather than in the tip's ink, for a
 * group's tip, whose balance is set in the money's own ink and has to be read
 * on the surface that ink was chosen for.
 */
export function SidebarTip({
  content,
  card,
  children,
}: {
  content: ReactNode;
  card?: boolean;
  children: ReactElement;
}) {
  const state = useContext(SidebarContext);
  // Held here rather than left to the tooltip, so it is controlled for its
  // whole life: shut whatever the pointer does while the sidebar is open.
  const [open, setOpen] = useState(false);
  // Outside a frame there is no provider to hang a tip from, and nothing is
  // ever folded.
  if (!state) return children;

  return (
    <Tooltip open={state.collapsed && open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={10}
        arrow={!card}
        className={cn(
          card &&
            "flex-col items-start gap-0 rounded-xl bg-popover px-3 py-2 text-popover-foreground shadow-raised ring-1 ring-border",
        )}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
