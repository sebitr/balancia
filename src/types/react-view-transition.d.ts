import type { ReactNode, Ref } from "react";

/**
 * `<ViewTransition>` and `addTransitionType` ship in the React canary that the
 * App Router bundles (`next/dist/compiled/react`), which is a version ahead of
 * the `@types/react` matching the `react` in package.json. Until the types
 * catch up, declare the two pieces this app uses.
 *
 * Verified against React 19.3.0-canary bundled with Next 16.3; see
 * `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`.
 */
declare module "react" {
  /**
   * Either one class for every transition, or a class per transition type as
   * named by `<Link transitionTypes>`. `"none"` opts out, `"auto"` asks React
   * for its own crossfade. A `default` key catches untyped navigations.
   */
  type ViewTransitionClass = string | Record<string, string>;

  interface ViewTransitionProps {
    children?: ReactNode;
    /** Shared identity — the same name on two screens morphs between them. */
    name?: string;
    default?: ViewTransitionClass;
    enter?: ViewTransitionClass;
    exit?: ViewTransitionClass;
    share?: ViewTransitionClass;
    update?: ViewTransitionClass;
    ref?: Ref<unknown>;
  }

  const ViewTransition: (props: ViewTransitionProps) => ReactNode;

  /**
   * Tags the surrounding transition, so `<ViewTransition>` can pick an
   * animation per type. Only meaningful inside a Transition.
   */
  function addTransitionType(type: string): void;
}
