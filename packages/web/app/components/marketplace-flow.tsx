"use client";

// Animated marketplace-flow diagram for the landing page.
//
// Two-sided exchange visualisation: GPU OWNER on the left, AI BUILDER
// on the right, with escrow + program in the middle. A 5-step cycle
// auto-plays on a loop, animating coins (USDC), envelopes (specs),
// and image packets (results) between the three entities.
//
// Replaces the static 3-card "How it works" list — the user wants a
// visual that explains the two-sided nature (idle gamer GPU + AI dev
// who needs compute) and the intermediary settlement.
//
// Built with framer-motion. lucide-react icons for the personas.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Code2, Lock, Coins, Image as ImageIcon } from "lucide-react";

const STEPS = [
  {
    id: "lock",
    label: "1. Lock USDC",
    detail: "Buyer signs create_job. Anchor moves USDC into a per-job escrow vault.",
    direction: "buyer-to-vault",
    icon: "coin",
    txTag: "create_job",
  },
  {
    id: "accept",
    label: "2. Accept",
    detail: "Provider's worker sees JobCreated, signs accept_job, status flips Funded → Started.",
    direction: "provider-to-vault",
    icon: "spec",
    txTag: "accept_job",
  },
  {
    id: "run",
    label: "3. Run inference",
    detail: "Provider GPU runs Flux Schnell on the prompt. Result PNG hashed + pinned to IPFS.",
    direction: "provider-self",
    icon: "image",
    txTag: "(off-chain compute)",
  },
  {
    id: "submit",
    label: "4. Submit proof",
    detail: "Provider signs submit_completion with sha256(PNG). Status flips Started → Completed.",
    direction: "provider-to-vault",
    icon: "image",
    txTag: "submit_completion",
  },
  {
    id: "settle",
    label: "5. Settle",
    detail: "Buyer confirms. Vault → provider (price − fee) + treasury (fee). Job + vault closed.",
    direction: "vault-to-provider",
    icon: "coin",
    txTag: "confirm_completion",
  },
] as const;

const STEP_INTERVAL_MS = 3200;

export function MarketplaceFlow() {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setStepIdx((i) => (i + 1) % STEPS.length),
      STEP_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, []);

  const step = STEPS[stepIdx];

  return (
    <section className="border-t border-white/10 py-24">
      <div className="mb-12 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#9945FF]">
          how the marketplace works
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-5xl">
          Two sides. One escrow. Settlement on Solana.
        </h2>
        <p className="mt-4 text-base leading-relaxed text-white/65">
          A gamer with an idle GPU and an AI builder with a job to run never
          have to trust each other. The Anchor program is the third party
          — it holds USDC, releases it on proof, and refunds it on timeout.
        </p>
      </div>

      <div className="relative grid grid-cols-1 items-stretch gap-6 md:grid-cols-[1fr_auto_1fr]">
        <Persona
          title="GPU owner"
          subtitle="Earn from idle hardware"
          icon={<Cpu className="h-6 w-6" strokeWidth={1.5} />}
          accent="#14F195"
          examples={[
            "Idle RTX 4090 between gaming sessions",
            "M3 Pro Mac mini in your closet",
            "Workstation with dedicated GPU at night",
          ]}
          cta="Run apis_worker, register a Provider PDA, get paid in USDC per job."
          isActive={
            step.direction === "provider-to-vault" ||
            step.direction === "provider-self" ||
            step.direction === "vault-to-provider"
          }
        />

        <CenterColumn step={step} stepIdx={stepIdx} />

        <Persona
          title="AI builder"
          subtitle="Rent compute, pay per job"
          icon={<Code2 className="h-6 w-6" strokeWidth={1.5} />}
          accent="#9945FF"
          examples={[
            "Indie devs prototyping with diffusion models",
            "Agents that need image generation on-demand",
            "Researchers running batch inference",
          ]}
          cta="Connect Phantom, post a prompt + price, get an IPFS-pinned result."
          isActive={step.direction === "buyer-to-vault"}
          alignRight
        />
      </div>

      {/* Step rail — clickable timeline so users can jump steps. */}
      <ol className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-5">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setStepIdx(i)}
              className={
                i === stepIdx
                  ? "block w-full rounded-lg border border-[#9945FF]/50 bg-[#9945FF]/10 p-3 text-left transition"
                  : "block w-full rounded-lg border border-white/10 bg-white/[0.02] p-3 text-left transition hover:border-white/25"
              }
            >
              <p
                className={
                  i === stepIdx
                    ? "font-mono text-[10px] uppercase tracking-wider text-[#9945FF]"
                    : "font-mono text-[10px] uppercase tracking-wider text-white/40"
                }
              >
                {s.label}
              </p>
              <code className="mt-1 block font-mono text-[10px] text-white/55">
                {s.txTag}
              </code>
            </button>
          </li>
        ))}
      </ol>

      {/* Currently-active step caption. */}
      <AnimatePresence mode="wait">
        <motion.p
          key={step.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35 }}
          className="mt-6 max-w-3xl text-sm leading-relaxed text-white/70"
        >
          <span className="font-semibold text-white">{step.label}.</span>{" "}
          {step.detail}
        </motion.p>
      </AnimatePresence>
    </section>
  );
}

// ─── Side cards ────────────────────────────────────────────────────────

function Persona({
  title,
  subtitle,
  icon,
  accent,
  examples,
  cta,
  isActive,
  alignRight = false,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: string;
  examples: string[];
  cta: string;
  isActive: boolean;
  alignRight?: boolean;
}) {
  return (
    <motion.div
      animate={{
        boxShadow: isActive
          ? `0 0 0 1px ${accent}66, 0 0 60px -15px ${accent}aa`
          : "0 0 0 1px rgba(255,255,255,0.06)",
      }}
      transition={{ duration: 0.4 }}
      className="relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6"
      style={{ alignItems: alignRight ? "flex-end" : "flex-start" }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${accent}1a`, color: accent }}
        >
          {icon}
        </span>
        <div className={alignRight ? "text-right" : ""}>
          <p className="text-lg font-semibold tracking-tight">{title}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-white/45">
            {subtitle}
          </p>
        </div>
      </div>

      <ul className={alignRight ? "space-y-1.5 text-right" : "space-y-1.5"}>
        {examples.map((ex) => (
          <li
            key={ex}
            className="flex items-center gap-2 text-xs text-white/65"
            style={{
              flexDirection: alignRight ? "row-reverse" : "row",
            }}
          >
            <span
              className="h-1 w-1 rounded-full"
              style={{ backgroundColor: accent }}
            />
            {ex}
          </li>
        ))}
      </ul>

      <p
        className={
          alignRight
            ? "text-right text-xs leading-relaxed text-white/55"
            : "text-xs leading-relaxed text-white/55"
        }
      >
        {cta}
      </p>

      <motion.div
        animate={{ opacity: isActive ? 1 : 0.25 }}
        transition={{ duration: 0.3 }}
        className="absolute right-3 top-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
        style={{ color: accent }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: accent,
            boxShadow: isActive ? `0 0 8px ${accent}` : "none",
          }}
        />
        {isActive ? "active" : "idle"}
      </motion.div>
    </motion.div>
  );
}

// ─── Center column: escrow + animated transactions ─────────────────────

function CenterColumn({ step, stepIdx }: { step: (typeof STEPS)[number]; stepIdx: number }) {
  return (
    <div className="relative flex w-full flex-col items-center justify-center md:w-72">
      {/* Vertical "spine" connecting the persona cards. */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-[#14F195]/30 via-white/40 to-[#9945FF]/30 md:hidden" />

      {/* Escrow vault visualization */}
      <motion.div
        animate={{
          boxShadow: `0 0 60px -10px ${
            step.direction === "buyer-to-vault" || step.direction === "provider-to-vault"
              ? "rgba(20,241,149,0.45)"
              : step.direction === "vault-to-provider"
                ? "rgba(153,69,255,0.45)"
                : "rgba(255,255,255,0.10)"
          }`,
        }}
        transition={{ duration: 0.45 }}
        className="relative z-20 flex w-full max-w-[18rem] flex-col items-center gap-3 rounded-2xl border border-white/15 bg-black/60 p-6 backdrop-blur-sm"
      >
        <Lock className="h-7 w-7 text-white/85" strokeWidth={1.5} />
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">
          Escrow vault
        </p>
        <p className="text-center text-xs text-white/65">
          Per-job ATA, owned by a Job PDA. Holds the buyer&apos;s USDC until
          settlement or refund.
        </p>
        <code className="rounded bg-white/[0.05] px-2 py-1 font-mono text-[10px] text-[#9945FF]">
          apis_program
        </code>

        {/* Step badge */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#9945FF]/15 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[#9945FF]"
          >
            {step.label}
          </motion.div>
        </AnimatePresence>

        {/* Pulsing ring indicating activity */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl border"
          animate={{
            borderColor: [
              "rgba(255,255,255,0.05)",
              "rgba(153,69,255,0.45)",
              "rgba(255,255,255,0.05)",
            ],
          }}
          transition={{ duration: 2.4, repeat: Infinity }}
        />
      </motion.div>

      {/* Flying particles between persona cards. Direction tied to the
          active step. Only visible on md+; on mobile the column stacks
          vertically and the linear motion doesn't read. */}
      <div className="pointer-events-none absolute left-0 right-0 top-1/2 hidden -translate-y-1/2 md:block">
        <FlyingParticle key={stepIdx} step={step} />
      </div>
    </div>
  );
}

function FlyingParticle({ step }: { step: (typeof STEPS)[number] }) {
  if (step.direction === "provider-self") {
    // Self-loop on the provider side — a quick swirl, no horizontal flight.
    return (
      <motion.div
        key={step.id}
        initial={{ opacity: 0, x: "calc(100% + 60px)", y: 30 }}
        animate={{
          opacity: [0, 1, 1, 0],
          x: ["calc(100% + 60px)", "calc(100% + 90px)", "calc(100% + 60px)"],
          y: [30, -10, 30],
        }}
        transition={{ duration: 2.0, ease: "easeInOut" }}
        className="absolute"
      >
        <ParticleGlyph icon="image" accent="#14F195" />
      </motion.div>
    );
  }

  // Map direction → from/to x positions (in % of the spine, with a bit
  // of padding so the particle lands on the persona card edge).
  const path = (() => {
    switch (step.direction) {
      case "buyer-to-vault":
        return { from: "calc(100% + 80px)", to: "50%", accent: "#9945FF" };
      case "provider-to-vault":
        return { from: "-80px", to: "50%", accent: "#14F195" };
      case "vault-to-provider":
        return { from: "50%", to: "-80px", accent: "#9945FF" };
      default:
        return { from: "50%", to: "50%", accent: "#FFFFFF" };
    }
  })();

  return (
    <motion.div
      key={step.id}
      initial={{ opacity: 0, left: path.from }}
      animate={{ opacity: [0, 1, 1, 0], left: [path.from, path.to] }}
      transition={{ duration: 1.8, ease: "easeInOut" }}
      className="absolute"
      style={{ transform: "translate(-50%, -50%)" }}
    >
      <ParticleGlyph icon={step.icon} accent={path.accent} />
    </motion.div>
  );
}

function ParticleGlyph({
  icon,
  accent,
}: {
  icon: "coin" | "spec" | "image";
  accent: string;
}) {
  const Icon =
    icon === "coin" ? Coins : icon === "image" ? ImageIcon : Code2;
  return (
    <span
      className="flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-sm"
      style={{
        backgroundColor: `${accent}1a`,
        borderColor: `${accent}66`,
        color: accent,
        boxShadow: `0 0 24px -2px ${accent}66`,
      }}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </span>
  );
}
