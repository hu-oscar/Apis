"use client";

// HexSwarmLoader — Sprint 3.5.
//
// On-brand loader for "the worker is doing something." Five hexagons
// in a horizontal row, sequenced to light up one at a time in a
// rolling wave from green → violet. Replaces the generic CSS spinner
// on /job/[id]'s Funded + Started states.
//
// Single SVG, ~8 KB animated via framer-motion's keyframe support —
// no images, no canvas, no extra deps.

import { motion } from "framer-motion";

type HexSwarmProps = {
  /** Pixel size of each hexagon (point-to-point). Default 18 — about
   *  as big as a heading caps-height. */
  size?: number;
  /** Wave period in seconds. Default 1.4s — slow enough to read,
   *  fast enough to feel alive. */
  duration?: number;
  /** Accessible label announced to screen readers. */
  label?: string;
};

const HEX_COUNT = 5;

export function HexSwarm({
  size = 18,
  duration = 1.4,
  label = "Loading",
}: HexSwarmProps) {
  // Stagger delay between adjacent hexagons. We want the wave to
  // travel from left → right and loop, so the last hex's wave
  // starts 4/5 of the way through the period.
  const stagger = duration / (HEX_COUNT * 1.4);
  const gap = size * 0.32;
  // Hex point-to-point width = sqrt(3) * radius. For a 1.0 size
  // value, the *flat-to-flat* width is `size * sqrt(3)/2`.
  const widthEach = size;
  const totalWidth = widthEach * HEX_COUNT + gap * (HEX_COUNT - 1);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="inline-flex items-center"
      style={{ width: totalWidth, height: size }}
    >
      {Array.from({ length: HEX_COUNT }, (_, i) => (
        <motion.svg
          key={i}
          viewBox="0 0 28 32"
          width={widthEach}
          height={size}
          aria-hidden
          style={{ marginLeft: i === 0 ? 0 : gap }}
          initial={{ opacity: 0.18, scale: 0.85 }}
          animate={{
            opacity: [0.18, 1, 0.18],
            scale: [0.85, 1, 0.85],
          }}
          transition={{
            duration,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * stagger,
          }}
        >
          {/* Pointy-top hexagon, matching docs/brand/apis-mark.svg
              geometry. Fill alternates green → violet around the
              middle so the wave reads as a color shift, not just a
              flicker. */}
          <path
            d="M14 0 L28 8 V24 L14 32 L0 24 V8 Z"
            fill={i % 2 === 0 ? "#14F195" : "#9945FF"}
          />
        </motion.svg>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
