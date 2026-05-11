"use client";

// Shared site-wide nav — Sprint 3.4.
//
// Used to be 5 inline copies (one per page), each slightly out of
// sync with the others — when /stats and /history landed in 3.2 we
// hand-pasted links to every nav. This component is the single
// source of truth. New routes get added in one place.
//
// Responsive: on desktop (≥ md) we render the full row of text links
// inline; on mobile (< md) the route links collapse behind a
// hamburger button that toggles an inline panel below the nav. The
// Connect Wallet button stays visible on all viewports — it's the
// most important affordance on the site.

import { useState } from "react";
import Link from "next/link";
import { useWalletConnection } from "@solana/react-hooks";

import { ApisLogo } from "./apis-logo";

export type NavRoute = "home" | "network" | "stats" | "history" | "submit";

type LinkSpec = { route: NavRoute; href: string; label: string };

const LINKS: ReadonlyArray<LinkSpec> = [
  { route: "network", href: "/network", label: "network" },
  { route: "stats", href: "/stats", label: "stats" },
  { route: "history", href: "/history", label: "history" },
  { route: "submit", href: "/submit", label: "submit" },
];

export function NavBar({
  active,
  showWallet = true,
}: {
  /** Highlight the active route in green so the user knows where they
   *  are. Pass "home" when on /. */
  active: NavRoute;
  /** Hide the connect-wallet button (e.g. on the error page where the
   *  wallet hook can't safely mount). Defaults to true everywhere
   *  else. */
  showWallet?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="relative flex items-center justify-between pb-8">
      <Link
        href="/"
        className="flex items-center gap-2.5 group"
        aria-label="Apis home"
      >
        <ApisLogo size={26} className="transition group-hover:scale-105" />
        <span className="font-mono text-lg font-bold tracking-tight text-[#FAFAF9] group-hover:text-[#14F195] transition">
          apis
        </span>
        <span className="rounded bg-[#9945FF]/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#9945FF]">
          devnet
        </span>
      </Link>

      {/* Desktop links — hidden under md to make room for the
          hamburger + connect wallet button. */}
      <div className="hidden items-center gap-4 md:flex">
        {LINKS.map((l) => (
          <NavLink key={l.route} link={l} active={active} />
        ))}
        {showWallet && <NavWalletButton />}
      </div>

      {/* Mobile: hamburger + (when present) wallet. */}
      <div className="flex items-center gap-3 md:hidden">
        {showWallet && <NavWalletButton compact />}
        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav-panel"
          onClick={() => setMenuOpen((o) => !o)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/[0.03] text-white/75 transition hover:border-white/30 hover:text-white"
        >
          <Hamburger open={menuOpen} />
        </button>
      </div>

      {/* Mobile panel — anchored under the nav, slides nothing
          fancier than CSS visibility. Closes when any link is
          tapped (the route change unmounts this component). */}
      {menuOpen && (
        <div
          id="mobile-nav-panel"
          className="absolute left-0 right-0 top-12 z-30 rounded-xl border border-white/10 bg-[#08080A]/95 p-4 backdrop-blur md:hidden"
        >
          <ul className="flex flex-col gap-2">
            {LINKS.map((l) => (
              <li key={l.route}>
                <Link
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  className={
                    l.route === active
                      ? "block rounded-md bg-[#14F195]/10 px-3 py-2 font-mono text-xs uppercase tracking-wider text-[#14F195]"
                      : "block rounded-md px-3 py-2 font-mono text-xs uppercase tracking-wider text-white/65 transition hover:bg-white/[0.04] hover:text-white"
                  }
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}

function NavLink({ link, active }: { link: LinkSpec; active: NavRoute }) {
  const isActive = link.route === active;
  return (
    <Link
      href={link.href}
      aria-current={isActive ? "page" : undefined}
      className={
        isActive
          ? "font-mono text-xs uppercase tracking-wider text-[#14F195]"
          : "font-mono text-xs uppercase tracking-wider text-white/60 transition hover:text-[#14F195]"
      }
    >
      {link.label}
    </Link>
  );
}

function Hamburger({ open }: { open: boolean }) {
  // Three-line icon → X when open. Pure SVG, no extra deps.
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      width="18"
      height="18"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path
            d="M5 5 L15 15"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M15 5 L5 15"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M4 6h12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M4 10h12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M4 14h12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

/** Connect / disconnect button. `compact` shaves the horizontal
 *  padding for the mobile bar where every pixel counts. */
function NavWalletButton({ compact }: { compact?: boolean } = {}) {
  const { wallet, status, connectors, connect, disconnect } =
    useWalletConnection();
  const address = wallet?.account.address;
  const padX = compact ? "px-2.5" : "px-3";

  if (status === "connected" && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        aria-label={`Disconnect wallet ${address}`}
        className={`rounded-lg border border-[#14F195]/30 bg-[#14F195]/[0.05] ${padX} py-1.5 font-mono text-xs text-[#14F195] transition hover:bg-[#14F195]/[0.1]`}
      >
        {address.slice(0, 4)}…{address.slice(-4)} ✕
      </button>
    );
  }

  const phantom = connectors.find((c) =>
    c.name.toLowerCase().includes("phantom"),
  );
  const target = phantom ?? connectors[0];

  return (
    <button
      type="button"
      onClick={() => target && connect(target.id)}
      disabled={!target || status === "connecting"}
      aria-label="Connect wallet"
      className={`rounded-lg bg-[#14F195] ${padX} py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-black shadow-[0_0_24px_-6px_rgba(20,241,149,0.6)] transition hover:bg-[#14F195]/90 disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {status === "connecting"
        ? "Connecting…"
        : compact
          ? "Connect"
          : "Connect wallet"}
    </button>
  );
}
