"use client";

// Landing-page section: "For autonomous AI agents" (Sprint 4 / F4).
//
// Sits directly under MarketplaceFlow on the landing page. Mirrors
// its role for the agent persona: where MarketplaceFlow explains the
// buyer-flow visually, this one explains the agent-flow with a
// Spline 3D scene + a static call-out grid.
//
// Aesthetic conforms to the Cyberpunk Swarm palette (Solana green +
// neon violet on pitch-black) — not the Aceternity demo's neutral
// gradient. The Spotlight + Spline primitives come from
// /components/ui/.

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Bot, Code2, Coins, Cpu } from "lucide-react";

import { SplineScene } from "./ui/splite";
import { Spotlight } from "./ui/spotlight";

export function AgentSection() {
  return (
    <section className="border-t border-white/10 py-24">
      {/* Section eyebrow + title (matches the MarketplaceFlow header
          rhythm above it). */}
      <div className="space-y-3 pb-10">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
          apis · for autonomous AI agents
        </p>
        <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
          The agent economy needs an
          <br />
          <span className="bg-gradient-to-r from-[#14F195] via-white to-[#9945FF] bg-clip-text text-transparent">
            agent-native compute market.
          </span>
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-white/65">
          AI agents can&apos;t open a Replicate account. They can&apos;t pass
          AWS KYC. They can&apos;t hold a credit card. But they can hold a
          Solana wallet, sign transactions, and pay USDC. Apis exposes the
          marketplace through MCP + x402 — your Claude / GPT / Gemini
          agent buys compute autonomously, no human in the loop.
        </p>
      </div>

      {/* Spline-led hero panel — text on the left, interactive 3D on
          the right. Spotlight runs once on entrance for the wash. */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative h-[460px] overflow-hidden rounded-2xl border border-white/10 bg-black/[0.96] md:h-[520px]"
      >
        <Spotlight
          className="-top-40 left-0 md:-top-20 md:left-60"
          fill="#14F195"
        />

        <div className="relative z-10 flex h-full flex-col md:flex-row">
          {/* Left — narrative copy. */}
          <div className="flex flex-1 flex-col justify-center p-8 md:p-10">
            <h3 className="bg-gradient-to-b from-neutral-50 to-neutral-400 bg-clip-text text-3xl font-bold leading-tight text-transparent md:text-4xl">
              Atlas-7
              <br />
              <span className="text-[#14F195]">buys its own compute.</span>
            </h3>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-neutral-300 md:text-base">
              Claude Sonnet 4.5 reads <code className="text-[#9945FF]">list_providers</code>{" "}
              over MCP, picks the fastest one in budget, refines the prompt
              for Flux Schnell, and pays via x402 — a single SPL USDC
              transfer carrying a server-issued memo. The Apis MCP server
              verifies the on-chain payment, signs{" "}
              <code className="text-[#9945FF]">create_job</code> + later{" "}
              <code className="text-[#9945FF]">confirm_completion</code>{" "}
              on the agent&apos;s behalf. End to end in ~60 seconds.
            </p>

            <div className="mt-6 grid gap-2 font-mono text-[11px] uppercase tracking-wider text-white/55">
              <CalloutLine icon="bot" label="Atlas-7 (Claude Sonnet 4.5)" detail="picks · refines · pays" />
              <CalloutLine icon="code" label="apis-mcp" detail="4 tools · streamable HTTP" />
              <CalloutLine icon="coin" label="x402 paywall" detail="self-verify on Solana" />
              <CalloutLine icon="cpu" label="apis_program" detail="server signs · escrow settles" />
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="https://github.com/hu-oscar/Apis/tree/main/packages/agent"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#14F195] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-black shadow-[0_0_24px_-6px_rgba(20,241,149,0.6)] transition hover:scale-[1.02]"
              >
                Read agent docs <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
              </Link>
              <Link
                href="https://github.com/hu-oscar/Apis/tree/main/packages/mcp"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] px-4 py-2 font-mono text-xs uppercase tracking-wider text-white/80 transition hover:border-white/30"
              >
                MCP tool surface
              </Link>
            </div>
          </div>

          {/* Right — Spline 3D scene. Hidden under md so the section
              stays readable on phones (the 3D runtime is ~600 KB +
              touch-interactive — questionable on mobile). */}
          <div className="relative hidden flex-1 md:block">
            <SplineScene
              scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
              className="h-full w-full"
            />
          </div>
        </div>
      </motion.div>

      <p className="pt-4 text-center font-mono text-[10px] uppercase tracking-wider text-white/30">
        the agent runs locally at v0.4.0 · MCP server hosting queued for v0.4.1
      </p>
    </section>
  );
}

function CalloutLine({
  icon,
  label,
  detail,
}: {
  icon: "bot" | "code" | "coin" | "cpu";
  label: string;
  detail: string;
}) {
  const Icon =
    icon === "bot" ? Bot : icon === "code" ? Code2 : icon === "coin" ? Coins : Cpu;
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-3.5 w-3.5 text-[#14F195]" strokeWidth={2} />
      <span className="text-white/80">{label}</span>
      <span className="text-white/35">·</span>
      <span className="text-white/45">{detail}</span>
    </div>
  );
}
