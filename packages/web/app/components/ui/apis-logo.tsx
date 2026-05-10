// Apis brand mark — honeycomb-cluster of pointy-top hexagons in the
// Cyberpunk Swarm palette (#14F195 Solana green, #9945FF violet).
//
// Geometry: 4 cells in a tight 2×2-ish layout. Two are outlined (the
// "open shells" — like the wireframe icosahedron in the hero), two
// are filled (the "active cells" — the in-flight transactions). The
// composition reads as both a honeycomb fragment (Apis = bee) and a
// network of nodes.
//
// Usage:
//   <ApisLogo />                 // 24×24 default
//   <ApisLogo size={32} />       // bigger
//   <ApisLogo className="..." /> // wrap in motion.span etc.

type Props = {
  /** Pixel size for both width and height. Default: 24. */
  size?: number;
  className?: string;
  /** Override the default aria-hidden if used as a content image. */
  title?: string;
};

export function ApisLogo({ size = 24, className, title }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}

      {/* Hex A — top-left, outlined Solana green. */}
      <path
        d="M9 4 L12.46 6 L12.46 10 L9 12 L5.54 10 L5.54 6 Z"
        stroke="#14F195"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Hex B — top-right, filled violet. */}
      <path
        d="M15.93 4 L19.39 6 L19.39 10 L15.93 12 L12.47 10 L12.47 6 Z"
        fill="#9945FF"
      />

      {/* Hex C — bottom-middle, outlined violet. */}
      <path
        d="M12.46 10 L15.93 12 L15.93 16 L12.46 18 L8.99 16 L8.99 12 Z"
        stroke="#9945FF"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Hex D — small satellite, filled Solana green. */}
      <path
        d="M19.39 14 L21.99 15.5 L21.99 18.5 L19.39 20 L16.79 18.5 L16.79 15.5 Z"
        fill="#14F195"
      />
    </svg>
  );
}
