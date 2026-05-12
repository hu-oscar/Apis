"use client";

// Spline 3D scene wrapper — Sprint 4.7 polish.
//
// Lazy-loaded so the ~600KB Spline runtime doesn't block the rest of
// the page. Falls back to a CSS-only loader while the runtime fetches
// the scene file (~2-4s on first paint, cached after that).

import { Suspense, lazy } from "react";

const Spline = lazy(() => import("@splinetool/react-spline"));

interface SplineSceneProps {
  scene: string;
  className?: string;
}

export function SplineScene({ scene, className }: SplineSceneProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#14F195]/30 border-t-[#14F195]" />
        </div>
      }
    >
      <Spline scene={scene} className={className} />
    </Suspense>
  );
}
