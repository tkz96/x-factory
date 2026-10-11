// test/helpers/overlay-exit-animations.ts — A controllable stand-in for the CSS exit
// animation React Aria waits on (#250).
//
// React Aria keeps an overlay in the DOM while its exit animation runs: it reads
// `element.getAnimations()` and waits for every running animation to finish before it
// unmounts. happy-dom applies no stylesheet, so no CSS animation is ever reported there
// and a close ends in the same tick. That is deterministic, but it also makes the
// exiting window invisible to a test, so `watchExitAnimations` reports one running
// animation on demand: a test can hold the window open, assert what is in the DOM, then
// release it. Nothing here changes production behaviour.

/** A running animation React Aria and the overlay are waiting on; `finish()` ends it. */
export interface ExitAnimationGate {
  /**
   * Ends the animation: `getAnimations()` stops reporting it and an `animationend` event
   * reaches the element, exactly as a browser delivers when a CSS animation is over.
   */
  finish: () => void;
}

export interface ExitAnimationWatch {
  /**
   * Makes every later `getAnimations()` call on a matching element report one running
   * animation, and returns the gate that ends it. Later calls share that same gate, so
   * one `finish()` releases the whole exit.
   */
  arm: () => ExitAnimationGate;
  /** Stops reporting animations and puts the DOM's own method back. */
  restore: () => void;
}

/**
 * Watches `selector` for React Aria's animation wait. Until `arm()` is called the
 * element reports whatever the DOM does (nothing, in happy-dom).
 */
export function watchExitAnimations(selector: string): ExitAnimationWatch {
  const original = HTMLElement.prototype.getAnimations;
  let pending: {
    finished: Promise<void>;
    elements: Set<HTMLElement>;
    settle: () => void;
  } | null = null;
  // React Aria also checks the animation's timeline, so hand it the DOM's own.
  const Timeline = (
    globalThis as { DocumentTimeline?: new () => AnimationTimeline }
  ).DocumentTimeline;
  const timeline = Timeline ? new Timeline() : undefined;

  HTMLElement.prototype.getAnimations = function (
    this: HTMLElement,
  ): Animation[] {
    if (!pending || !this.matches(selector)) return original.call(this);
    pending.elements.add(this);
    // Only `playState`, `timeline` and `finished` are read by the code that waits on
    // animations, so a partial stand-in is enough.
    return [
      {
        playState: "running",
        timeline,
        finished: pending.finished,
      } as unknown as Animation,
    ];
  };

  return {
    arm() {
      let settle: () => void = () => {};
      const finished = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const elements = new Set<HTMLElement>();
      pending = { finished, elements, settle };
      return {
        finish: () => {
          const gate = pending;
          pending = null;
          gate?.settle();
          for (const element of gate?.elements ?? []) {
            element.dispatchEvent(new Event("animationend"));
          }
        },
      };
    },
    restore() {
      pending = null;
      HTMLElement.prototype.getAnimations = original;
    },
  };
}
