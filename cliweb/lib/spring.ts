/**
 * A minimal, interruptible spring — the physics behind everything the user
 * can grab.
 *
 * The whole point is that motion starts from the value that is on screen
 * *right now*, inherits the velocity the finger was carrying, and can be
 * retargeted mid-flight without a hitch. A CSS transition cannot do that: it
 * restarts from a stored origin and fights a reversal. So drags, sheets and
 * drawers spring; fire-and-forget entrances stay in CSS.
 *
 * Springs are described the way designers think about them — how long it
 * visually takes to arrive (`response`) and how much it overshoots
 * (`bounce`) — not as stiffness/mass/damping.
 */

export interface SpringOptions {
  /** Seconds to visually reach the target. Smaller is snappier. */
  response?: number;
  /** Overshoot: 0 is critically damped, 0.15–0.25 is lively. */
  bounce?: number;
  /** Initial velocity in units/second — hand the release velocity in here. */
  velocity?: number;
}

/** Apple's shipping values, so we are not inventing numbers. */
export const SPRING = {
  /** Move / reposition: damping 1.0, response 0.4. */
  reposition: { response: 0.4, bounce: 0 },
  /** Drawer / sheet: damping 0.8, response 0.3. */
  sheet: { response: 0.3, bounce: 0.16 },
  /** Snappy control feedback. */
  control: { response: 0.25, bounce: 0 },
} satisfies Record<string, SpringOptions>;

const REST_DISPLACEMENT = 0.15;
const REST_VELOCITY = 0.6;

export interface SpringHandle {
  /** Retarget without losing the live value or velocity. */
  setTarget(next: number): void;
  /** Current on-screen value. */
  readonly value: number;
  /** Current velocity, units/second. */
  readonly velocity: number;
  /** Jump to a value, killing motion — use while a pointer is down. */
  set(next: number): void;
  stop(): void;
}

/**
 * Drives `onFrame` with a spring from `from` to `to`.
 *
 * Returns a handle whose `setTarget` springs from wherever the value
 * currently is, which is what makes a reversal mid-gesture feel physical
 * rather than like a restarted animation.
 */
export function spring(
  from: number,
  to: number,
  onFrame: (value: number) => void,
  options: SpringOptions = {},
  onRest?: () => void
): SpringHandle {
  const { response = 0.4, bounce = 0, velocity = 0 } = options;

  // response/bounce → the classic constants.
  const omega = (2 * Math.PI) / Math.max(response, 0.01);
  const zeta = 1 - Math.min(Math.max(bounce, 0), 0.9);

  let value = from;
  let vel = velocity;
  let target = to;
  let raf = 0;
  let last = 0;

  const step = (now: number) => {
    // Clamp dt so a backgrounded tab does not launch the value into orbit.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    const displacement = value - target;
    const accel = -omega * omega * displacement - 2 * zeta * omega * vel;
    vel += accel * dt;
    value += vel * dt;

    if (
      Math.abs(value - target) < REST_DISPLACEMENT &&
      Math.abs(vel) < REST_VELOCITY
    ) {
      value = target;
      vel = 0;
      onFrame(value);
      raf = 0;
      onRest?.();
      return;
    }

    onFrame(value);
    raf = requestAnimationFrame(step);
  };

  const start = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(step);
  };

  start();

  return {
    get value() {
      return value;
    },
    get velocity() {
      return vel;
    },
    setTarget(next: number) {
      target = next;
      start();
    },
    set(next: number) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      value = next;
      vel = 0;
      onFrame(value);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      vel = 0;
    },
  };
}

/**
 * Apple's momentum projection: where a flick would have carried the content,
 * not where the finger happened to lift.
 *
 * This is the real function from *Designing Fluid Interfaces* — not the
 * textbook v²/(2·decel), which overshoots badly.
 */
export function projectMomentum(
  velocity: number,
  decelerationRate = 0.998
): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Rubber-banding: content resists progressively past a boundary instead of
 * hard-stopping. A clamp feels cheap; this feels like a real edge.
 */
export function rubberBand(overshoot: number, dimension: number, c = 0.55) {
  return (
    (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot))
  );
}

/** Tracks pointer samples so a release can hand its velocity to a spring. */
export class VelocityTracker {
  private samples: { v: number; t: number }[] = [];

  add(value: number) {
    const t = performance.now();
    this.samples.push({ v: value, t });
    if (this.samples.length > 5) this.samples.shift();
  }

  /** Units per second at release. */
  get velocity(): number {
    if (this.samples.length < 2) return 0;
    const b = this.samples[this.samples.length - 1];
    const a = this.samples[this.samples.length - 2];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return 0;
    return (b.v - a.v) / dt;
  }

  reset() {
    this.samples = [];
  }
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
