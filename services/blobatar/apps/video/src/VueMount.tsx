/**
 * A real Vue app, mounted inside a Remotion frame.
 *
 * This exists so the adapters film can be honest. Remotion is React, so the
 * cheap version of this film renders every frame with `@blobatar/react` and
 * merely *writes* `@blobatar/vue` in the code pane — a film that asserts parity
 * while quietly demonstrating one adapter twice. The whole point is the other
 * thing: when the code says Vue, the creature on screen was rendered by
 * `@blobatar/vue`, through Vue's own runtime, in that frame.
 *
 * It works because nothing about the motion layer is framework-shaped. The
 * idle loops are CSS on classes the adapter emits, and `seek.css` seeks them
 * off `--vid-t`, which is inherited from the stage — so a Vue subtree nested in
 * a React stage is on the same clock as everything around it, with no bridge.
 *
 * `delayRender` is what makes it safe. The mount lands in an effect, one paint
 * after React's own output, and Remotion captures as soon as the component
 * paints — so without the handle an unknown number of leading frames would
 * capture an empty box. Same failure mode, and same fix, as `fonts.ts`.
 */

import { useEffect, useRef, useState, type FC } from "react";
import { continueRender, delayRender } from "remotion";
import { createApp, h, type Component } from "vue";

export const VueMount: FC<{
  component: Component;
  props: Record<string, unknown>;
}> = ({ component, props }) => {
  const host = useRef<HTMLDivElement>(null);
  const [handle] = useState(() => delayRender("mounting the vue adapter"));

  useEffect(() => {
    if (!host.current) return;
    const app = createApp({ render: () => h(component, props) });
    app.mount(host.current);
    continueRender(handle);
    return () => app.unmount();
    // The props are fixed for the film's whole run; re-mounting per frame would
    // restart the CSS animations, which is the one thing that must not happen —
    // a loop that restarts is a loop `seek.css` can no longer place in time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} style={{ display: "contents" }} />;
};
