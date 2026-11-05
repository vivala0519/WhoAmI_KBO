import { useEffect, useRef, useState } from "react";
import "./particle-ball.css";

type Theme = "light" | "dark";
type Particle = {
  x: number;
  y: number;
  z: number;
  spreadX: number;
  spreadY: number;
  spreadZ: number;
  offsetX: number;
  offsetY: number;
  velocityX: number;
  velocityY: number;
  size: number;
};
type ParticleGroup = { light: string; dark: string; points: Particle[] };
const SOURCE = "/particle-baseball.png";
const FRAME_MS = 1000 / 30;
const SCATTER_MS = 250;
const RETURN_AFTER_MS = 3000;
const REASSEMBLE_MS = 900;
const clamp = (n: number, low: number, high: number) =>
  Math.min(high, Math.max(low, n));
const random = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};
const quantize = (n: number) => clamp(Math.round(n / 16) * 16, 0, 255);

/** Sample the supplied baseball image on a shallow 3D front surface. */
function sample(image: HTMLImageElement): {
  groups: ParticleGroup[];
  count: number;
} {
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = 256;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas sampling is unavailable");
  const scale = 256 / Math.max(image.naturalWidth, image.naturalHeight);
  const w = image.naturalWidth * scale,
    h = image.naturalHeight * scale;
  context.drawImage(image, (256 - w) / 2, (256 - h) / 2, w, h);
  const { data } = context.getImageData(0, 0, 256, 256);
  let left = 256,
    top = 256,
    right = 0,
    bottom = 0;
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      if (data[(y * 256 + x) * 4 + 3] < 90) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  if (left >= right || top >= bottom)
    throw new Error("The ball image is empty");
  const centerX = (left + right) / 2,
    centerY = (top + bottom) / 2;
  const radius = Math.max(right - left, bottom - top) / 2;
  const step = (radius * 2) / 100;
  const buckets = new Map<string, ParticleGroup>();
  let count = 0;
  for (let row = 0, sy = top; sy <= bottom; row++, sy += step) {
    for (let column = 0, sx = left; sx <= right; column++, sx += step) {
      const seed = row * 131 + column;
      const px =
        sx + (row % 2 ? step / 2 : 0) + (random(seed) - 0.5) * step * 0.22;
      const py = sy + (random(seed + 99) - 0.5) * step * 0.22;
      const x = (px - centerX) / radius,
        y = (py - centerY) / radius;
      const r2 = x * x + y * y;
      if (r2 > 1.01) continue;
      const index =
        (clamp(Math.round(py), 0, 255) * 256 + clamp(Math.round(px), 0, 255)) *
        4;
      if (data[index + 3] < 90) continue;
      const r = data[index],
        g = data[index + 1],
        b = data[index + 2];
      const z = Math.sqrt(Math.max(0, 1 - r2));
      // White leather needs contrast on light; lift the navy stitching on dark.
      const pale = clamp((Math.min(r, g, b) - 140) / 100, 0, 1);
      const lightR = quantize(r * (1 - pale * 0.58));
      const lightG = quantize(g * (1 - pale * 0.58));
      const lightB = quantize(b * (1 - pale * 0.58));
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const navy = b > r * 1.1 && b > g * 1.1;
      const lift = navy ? clamp((125 - luminance) / 125, 0, 1) * 0.52 : 0;
      const darkR = quantize(r + (155 - r) * lift);
      const darkG = quantize(g + (175 - g) * lift);
      const darkB = quantize(b + (205 - b) * lift);
      const alpha = z > 0.65 ? 0.96 : z > 0.3 ? 0.88 : 0.76;
      const light =
        "rgba(" + lightR + "," + lightG + "," + lightB + "," + alpha + ")";
      const dark =
        "rgba(" + darkR + "," + darkG + "," + darkB + "," + alpha + ")";
      const key = light + dark;
      let group = buckets.get(key);
      if (!group) {
        group = { light, dark, points: [] };
        buckets.set(key, group);
      }
      const angle = random(seed + 235) * Math.PI * 2;
      const spread = 1.25 + random(seed + 377) * 1.8;
      group.points.push({
        x,
        y,
        z,
        spreadX: Math.cos(angle) * spread,
        spreadY: Math.sin(angle) * spread,
        spreadZ: random(seed + 517) * 2 - 1,
        offsetX: 0,
        offsetY: 0,
        velocityX: 0,
        velocityY: 0,
        size: 0.88 + random(seed + 719) * 0.22,
      });
      count++;
    }
  }
  if (!count) throw new Error("The ball image has no visible particles");
  return { groups: [...buckets.values()], count };
}

export function ParticleBall({ theme }: { theme: Theme }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef(theme);
  const redrawRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    themeRef.current = theme;
    redrawRef.current?.();
  }, [theme]);

  useEffect(() => {
    const host = hostRef.current,
      canvas = canvasRef.current;
    if (!host || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motion.matches;
    let disposed = false,
      failed = false,
      loaded = false,
      announced = false;
    let inView = true,
      width = 0,
      height = 0,
      dpr = 1;
    let frame = 0,
      lastFrame = 0,
      elapsed = 0;
    let groups: ParticleGroup[] = [];
    let burstAt: number | null = null;
    let burstFrom = 0;
    let gesture: { id: number; x: number; y: number; at: number } | null = null;
    host.dataset.phase = "loading";
    const setPhase = (phase: string) => {
      if (host.dataset.phase !== phase) host.dataset.phase = phase;
    };
    const burstAmount = (now: number) => {
      if (burstAt === null) return 0;
      const age = now - burstAt;
      if (age < SCATTER_MS) {
        const outward = 1 - Math.pow(1 - age / SCATTER_MS, 3);
        return burstFrom + (1 - burstFrom) * outward;
      }
      if (age < RETURN_AFTER_MS) return 1;
      const returnProgress = clamp(
        (age - RETURN_AFTER_MS) / REASSEMBLE_MS,
        0,
        1,
      );
      return 1 - returnProgress * returnProgress * (3 - 2 * returnProgress);
    };
    const pointer = { x: 0, y: 0, active: false };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = 0;
    };
    const fail = () => {
      failed = true;
      setPhase("fallback");
      stop();
      if (!disposed) setReady(false);
    };
    const drawable = () =>
      !disposed && !failed && loaded && width > 0 && height > 0;
    const visible = () =>
      inView &&
      document.visibilityState !== "hidden" &&
      width > 0 &&
      height > 0;

    const draw = (dt: number, staticFrame = reducedMotion) => {
      if (!drawable()) return;
      try {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        const t = staticFrame ? 0 : elapsed / 1000;
        const progress = staticFrame ? 1 : clamp(elapsed / 1750, 0, 1);
        const scattered = Math.pow(1 - progress, 3);
        const now = performance.now();
        const tapScatter = staticFrame ? 0 : burstAmount(now);
        if (
          burstAt !== null &&
          now - burstAt >= RETURN_AFTER_MS + REASSEMBLE_MS
        )
          burstAt = null;
        setPhase(
          staticFrame
            ? "still"
            : burstAt !== null
              ? now - burstAt < SCATTER_MS
                ? "scattering"
                : now - burstAt < RETURN_AFTER_MS
                  ? "scattered"
                  : "assembling"
              : progress < 1
                ? "assembling"
                : "rotating",
        );
        const yaw = staticFrame ? 0 : Math.sin(t * 0.32) * 0.14;
        const pitch = staticFrame ? 0 : Math.sin(t * 0.24) * 0.1;
        // Continuous view-axis spin keeps the supplied single-view texture intact.
        const roll = staticFrame ? 0 : t * 0.26;
        const cy = Math.cos(yaw),
          sy = Math.sin(yaw);
        const cp = Math.cos(pitch),
          sp = Math.sin(pitch);
        const cr = Math.cos(roll),
          sr = Math.sin(roll);
        const radius = Math.min(width, height) * 0.435;
        const centerX = width / 2;
        const centerY = height / 2 + (staticFrame ? 0 : Math.sin(t * 0.85) * 3);
        const springStep = Math.min(2.5, dt * 60);
        const sizeScale = Math.min(width / 340, height / 300);
        for (const group of groups) {
          context.fillStyle =
            themeRef.current === "light" ? group.light : group.dark;
          context.beginPath();
          for (const p of group.points) {
            const introX = p.x + (p.spreadX - p.x) * scattered;
            const introY = p.y + (p.spreadY - p.y) * scattered;
            const introZ = p.z + (p.spreadZ - p.z) * scattered;
            // Keep most scattered dots inside the compact header canvas.
            const x = introX + (p.spreadX * 0.42 - introX) * tapScatter;
            const y = introY + (p.spreadY * 0.42 - introY) * tapScatter;
            const z = introZ + (p.spreadZ * 0.42 - introZ) * tapScatter;
            const rx = x * cy + z * sy;
            const rz = z * cy - x * sy;
            const ry = y * cp - rz * sp;
            const depth = y * sp + rz * cp;
            const scale = radius * (1 + depth * 0.018);
            const px = centerX + (rx * cr - ry * sr) * scale;
            const py = centerY + (rx * sr + ry * cr) * scale;
            let targetX = 0,
              targetY = 0;
            if (
              pointer.active &&
              !staticFrame &&
              progress > 0.9 &&
              tapScatter < 0.01
            ) {
              const dx = px - pointer.x,
                dy = py - pointer.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              if (distance < 65 && distance > 0.1) {
                const force = Math.pow(1 - distance / 65, 2) * 14;
                targetX = (dx / distance) * force;
                targetY = (dy / distance) * force;
              }
            }
            if (!staticFrame) {
              p.velocityX =
                (p.velocityX + (targetX - p.offsetX) * 0.09 * springStep) *
                Math.pow(0.75, springStep);
              p.velocityY =
                (p.velocityY + (targetY - p.offsetY) * 0.09 * springStep) *
                Math.pow(0.75, springStep);
              p.offsetX += p.velocityX * springStep;
              p.offsetY += p.velocityY * springStep;
            }
            const ox = staticFrame ? 0 : p.offsetX,
              oy = staticFrame ? 0 : p.offsetY;
            const dot = p.size * sizeScale * (1.05 + p.z * 0.12);
            context.moveTo(px + ox + dot, py + oy);
            context.arc(px + ox, py + oy, dot, 0, Math.PI * 2);
          }
          context.fill();
        }
        if (!announced) {
          announced = true;
          setReady(true);
        }
      } catch {
        fail();
      }
    };
    const animate = (now: number) => {
      frame = 0;
      if (!drawable() || !visible() || reducedMotion) return;
      if (!lastFrame || now - lastFrame >= FRAME_MS - 0.5) {
        const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.07) : 0;
        elapsed += dt * 1000;
        lastFrame = now;
        draw(dt);
      }
      if (!failed) frame = requestAnimationFrame(animate);
    };
    const reconcile = () => {
      if (!drawable() || !visible()) {
        stop();
        return;
      }
      if (reducedMotion) {
        stop();
        draw(0, true);
        return;
      }
      if (!frame) {
        lastFrame = 0;
        frame = requestAnimationFrame(animate);
      }
    };
    const resize = () => {
      const bounds = host.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        if (drawable()) draw(0);
      }
      reconcile();
    };
    const onMotion = () => {
      reducedMotion = motion.matches;
      pointer.active = false;
      gesture = null;
      if (reducedMotion) burstAt = null;
      reconcile();
    };
    const onPointer = (event: PointerEvent) => {
      if (reducedMotion || !visible() || event.pointerType === "touch") {
        pointer.active = false;
        return;
      }
      const bounds = host.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
      pointer.active =
        pointer.x > -35 &&
        pointer.x < width + 35 &&
        pointer.y > -35 &&
        pointer.y < height + 35;
    };
    const isControl = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest(
        'button,a,input,textarea,select,[role="button"],[role="tab"],dialog',
      );
    const hitsBall = (x: number, y: number) => {
      const bounds = host.getBoundingClientRect();
      const dx = x - bounds.left - width / 2;
      const dy = y - bounds.top - height / 2;
      return dx * dx + dy * dy <= Math.pow(Math.min(width, height) * 0.47, 2);
    };
    const onDown = (event: PointerEvent) => {
      if (
        !event.isPrimary ||
        event.button !== 0 ||
        !drawable() ||
        !visible() ||
        reducedMotion ||
        isControl(event.target) ||
        !hitsBall(event.clientX, event.clientY)
      )
        return;
      gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        at: performance.now(),
      };
    };
    const onUp = (event: PointerEvent) => {
      const candidate = gesture;
      if (!candidate || candidate.id !== event.pointerId) return;
      gesture = null;
      const now = performance.now();
      if (
        !drawable() ||
        !visible() ||
        reducedMotion ||
        isControl(event.target) ||
        now - candidate.at > 700 ||
        Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) >
          10 ||
        !hitsBall(event.clientX, event.clientY)
      )
        return;
      burstFrom = burstAmount(now);
      burstAt = now;
      pointer.active = false;
      setPhase("scattering");
      reconcile();
    };
    const cancelGesture = () => {
      gesture = null;
    };
    const leave = () => {
      pointer.active = false;
      gesture = null;
    };
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (disposed) return;
      try {
        const sampled = sample(image);
        groups = sampled.groups;
        setCount(sampled.count);
        loaded = true;
        resize();
      } catch {
        fail();
      }
    };
    image.onerror = fail;
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const intersection = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      reconcile();
    });
    intersection.observe(host);
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", cancelGesture, { passive: true });
    window.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    motion.addEventListener("change", onMotion);
    redrawRef.current = () => {
      if (drawable()) draw(0);
    };
    resize();
    image.src = SOURCE;
    return () => {
      disposed = true;
      stop();
      redrawRef.current = null;
      image.onload = null;
      image.onerror = null;
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cancelGesture);
      gesture = null;
      burstAt = null;
      window.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      motion.removeEventListener("change", onMotion);
      groups = [];
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="particle-ball"
      aria-hidden="true"
      data-state={ready ? "ready" : "fallback"}
      data-particle-count={count}
    >
      <img
        className="particle-ball-fallback"
        src={SOURCE}
        alt=""
        draggable={false}
      />
      <canvas ref={canvasRef} className="particle-ball-canvas" />
    </div>
  );
}
