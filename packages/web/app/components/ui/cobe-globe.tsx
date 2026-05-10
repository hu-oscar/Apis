"use client";

// Cobe-rendered Solana provider globe.
//
// Markers represent existing or potential GPU providers around the
// world; arcs represent live job flows (buyer → provider). Tuned to
// the Cyberpunk Swarm palette (dark base, Solana green markers, violet
// arcs). Drag to spin, releases to inertia.
//
// Adapted from the cobe snippet in the W5 polish brief. TS-typed,
// pointer cleanup correctness, sensible defaults.

import {
  useEffect,
  useRef,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";
import createGlobe from "cobe";

export type Marker = {
  id: string;
  location: [number, number];
  label: string;
};

export type Arc = {
  id: string;
  from: [number, number];
  to: [number, number];
  label?: string;
};

export type GlobeProps = {
  markers?: Marker[];
  arcs?: Arc[];
  className?: string;
  markerColor?: [number, number, number];
  baseColor?: [number, number, number];
  arcColor?: [number, number, number];
  glowColor?: [number, number, number];
  dark?: number;
  mapBrightness?: number;
  markerSize?: number;
  markerElevation?: number;
  arcWidth?: number;
  arcHeight?: number;
  speed?: number;
  theta?: number;
  diffuse?: number;
  mapSamples?: number;
};

export function Globe({
  markers = [],
  arcs = [],
  className = "",
  // Cyberpunk Swarm defaults: Solana green markers, violet arcs,
  // muted dark base. The cobe color tuples are 0..1 RGB, so:
  //   #14F195 → [0.078, 0.945, 0.584]
  //   #9945FF → [0.6,   0.27,  1.0]
  markerColor = [0.078, 0.945, 0.584],
  baseColor = [0.18, 0.18, 0.22],
  arcColor = [0.6, 0.27, 1.0],
  glowColor = [0.6, 0.27, 1.0],
  dark = 1,
  mapBrightness = 4,
  markerSize = 0.04,
  markerElevation = 0.01,
  arcWidth = 0.6,
  arcHeight = 0.35,
  speed = 0.0035,
  theta = 0.25,
  diffuse = 1.2,
  mapSamples = 16000,
}: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerInteracting = useRef<{ x: number; y: number } | null>(null);
  const lastPointer = useRef<{ x: number; y: number; t: number } | null>(null);
  const dragOffset = useRef({ phi: 0, theta: 0 });
  const velocity = useRef({ phi: 0, theta: 0 });
  const phiOffsetRef = useRef(0);
  const thetaOffsetRef = useRef(0);
  const isPausedRef = useRef(false);

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY };
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    isPausedRef.current = true;
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (pointerInteracting.current !== null) {
      const deltaX = e.clientX - pointerInteracting.current.x;
      const deltaY = e.clientY - pointerInteracting.current.y;
      dragOffset.current = { phi: deltaX / 300, theta: deltaY / 1000 };
      const now = Date.now();
      if (lastPointer.current) {
        const dt = Math.max(now - lastPointer.current.t, 1);
        const maxV = 0.15;
        velocity.current = {
          phi: Math.max(
            -maxV,
            Math.min(maxV, ((e.clientX - lastPointer.current.x) / dt) * 0.3),
          ),
          theta: Math.max(
            -maxV,
            Math.min(maxV, ((e.clientY - lastPointer.current.y) / dt) * 0.08),
          ),
        };
      }
      lastPointer.current = { x: e.clientX, y: e.clientY, t: now };
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi;
      thetaOffsetRef.current += dragOffset.current.theta;
      dragOffset.current = { phi: 0, theta: 0 };
      lastPointer.current = null;
    }
    pointerInteracting.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    isPausedRef.current = false;
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let globe: ReturnType<typeof createGlobe> | null = null;
    let animationId = 0;
    let phi = 0;

    const init = () => {
      const width = canvas.offsetWidth;
      if (width === 0 || globe) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      globe = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width: width * dpr,
        height: width * dpr,
        phi: 0,
        theta,
        dark,
        diffuse,
        mapSamples,
        mapBrightness,
        baseColor,
        markerColor,
        glowColor,
        markers: markers.map((m) => ({ location: m.location, size: markerSize })),
        arcs: arcs.map((a) => ({ from: a.from, to: a.to, id: a.id })),
        arcColor,
        arcWidth,
        arcHeight,
        markerElevation,
        opacity: 0.85,
      });

      // Drive rotation imperatively via globe.update() in a RAF loop.
      const animate = () => {
        if (!isPausedRef.current) {
          phi += speed;
          // Damped inertia from any active drag.
          if (
            Math.abs(velocity.current.phi) > 0.0001 ||
            Math.abs(velocity.current.theta) > 0.0001
          ) {
            phiOffsetRef.current += velocity.current.phi;
            thetaOffsetRef.current += velocity.current.theta;
            velocity.current.phi *= 0.95;
            velocity.current.theta *= 0.95;
          }
          // Clamp tilt so we don't flip the camera over the poles.
          const tMin = -0.4;
          const tMax = 0.4;
          if (thetaOffsetRef.current < tMin) {
            thetaOffsetRef.current += (tMin - thetaOffsetRef.current) * 0.1;
          } else if (thetaOffsetRef.current > tMax) {
            thetaOffsetRef.current += (tMax - thetaOffsetRef.current) * 0.1;
          }
        }
        if (globe) {
          globe.update({
            phi: phi + phiOffsetRef.current + dragOffset.current.phi,
            theta: theta + thetaOffsetRef.current + dragOffset.current.theta,
          });
        }
        animationId = requestAnimationFrame(animate);
      };
      animate();
      // Fade in once cobe has rendered the first frame.
      requestAnimationFrame(() => {
        if (canvas) canvas.style.opacity = "1";
      });
    };

    if (canvas.offsetWidth > 0) {
      init();
    } else {
      const ro = new ResizeObserver((entries) => {
        if (entries[0]?.contentRect.width && entries[0].contentRect.width > 0) {
          ro.disconnect();
          init();
        }
      });
      ro.observe(canvas);
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (globe) globe.destroy();
    };
    // We deliberately don't depend on `arcs` since cobe doesn't natively
    // support them in our wrapper — they're for our own anchor-positioned
    // labels in the JSX below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    markers,
    markerColor,
    baseColor,
    arcColor,
    glowColor,
    dark,
    mapBrightness,
    markerSize,
    markerElevation,
    arcWidth,
    arcHeight,
    speed,
    theta,
    diffuse,
    mapSamples,
  ]);

  return (
    <div className={`relative aspect-square select-none ${className}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: "100%",
          height: "100%",
          cursor: "grab",
          opacity: 0,
          transition: "opacity 1.2s ease",
          touchAction: "none",
        }}
      />
    </div>
  );
}
