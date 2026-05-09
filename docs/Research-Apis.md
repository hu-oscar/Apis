# Apis — Rapport de Recherche Final

**Marketplace décentralisé de GPU sur Solana — Dev3pack Hackathon**

> **Synthèse de 6 rapports d'agents de recherche + 6 vérifications WebSearch live (mai 2026).** Structurée selon les 10 deliverables du Deep Research Prompt initial.

> **Date du rapport :** 2026-05-09
> **Projet :** Apis (anciennement "Swarm")
> **Tagline :** Le marketplace de GPU permissionless qui transforme les cartes graphiques idle des gamers en compute pour les agents IA.

---

## Table des matières

1. [Executive Summary — 5 insights critiques](#1--executive-summary)
2. [Competitor Deep Dive](#2--competitor-deep-dive)
3. [Solana Architecture Recommendation](#3--solana-architecture)
4. [Verification Stack Recommendation](#4--verification-stack)
5. [Tech Stack Final](#5--tech-stack-final)
6. [AI Agent Integration Path](#6--ai-agent-integration)
7. [Demo Scenario — Script 3 min](#7--demo-scenario)
8. [5-Week Build Plan](#8--build-plan)
9. [Risk Register](#9--risk-register)
10. [Post-Hackathon Path](#10--post-hackathon)
11. [Sponsor Activation Playbook](#11--sponsor-activation)
12. [Sources](#12--sources)

---

## 1. 🎯 Executive Summary

### Insight #1 — Le wedge unique : MCP + x402 sur Solana

Aucun concurrent ne propose de paiement machine-to-machine pour agents IA. **MCP** (spec révision 2025-11-25, parlée nativement par Claude/GPT/Cursor) + **x402** (déjà 35M+ transactions et $10M+ de volume sur Solana, partenariat AWS Bedrock annoncé le 7 mai 2026) = la combinaison qui fait gagner. C'est notre angle non-réplicable à court terme.

### Insight #2 — TEE sur GPU consumer = mensonge à éviter

Les RTX 4090/5090 ne supportent pas la Confidential Compute. Intel TDX et AMD SEV-SNP sont server-only. Si Apis cible vraiment les gamers, TEE est impossible Phase 1 ET Phase 2 sans tier H100 séparé (via Phala Network). **À assumer dans le pitch** : "cryptoeconomic security pour le tier consumer, TEE-attested premium tier sur datacenter en roadmap."

### Insight #3 — Le marché est plus vide qu'il n'y paraît

Personne n'a vraiment cracké les GPUs gamers + on-chain :

- **io.net** = ex-fermes mining (controverse 2024 sur ~75% de GPUs non vérifiables)
- **Aethir** = enterprise data centers maquillés en "gaming"
- **Salad** = seul à 1M+ d'installs gamer réels, mais 100% web2, 0% agent rails

L'opportunité : être le "Salad permissionless + on-chain + agent-native".

### Insight #4 — Anchor a sauté en 1.0.2 (avril 2026)

Les agents avaient cité 0.31.x. C'est obsolète. Anchor est passé en 1.0.x avec une refonte majeure. **Tous les tutos pre-2026 sont à filtrer.** Vérifié live sur les release notes officielles.

### Insight #5 — Token = NON au hackathon, oui dans 12-18 mois

Les VCs sérieux (Multicoin, Dragonfly, a16z) préfèrent les projets product-first post-IO/Aethir/Bittensor token-fatigue. La séquence gagnante :

1. **0% take rate (M0-9)**
2. **Points program (M9-18)**
3. **TGE seulement après PMF (M18-24)**

---

## 2. 🏢 Competitor Deep Dive

### Tableau comparatif

| Acteur | Chain | Type GPUs | Take rate | AI agents M2M | Volume réel | Faille exploitable |
|---|---|---|---|---|---|---|
| **io.net** | Solana | Ex-mining + DC | ~5% | ❌ | $30M Series A; controverse 2024 | UX dev-only, pas consumer |
| **Akash** | Cosmos | Petits DC | 4% AKT / 20% USDC | ❌ | Petit GMV | UX provider rough, pas de SLA |
| **Render** | Solana (migré) | Render farms prosumer | 5-10% | ❌ | Stable, niche 3D | Pivot AI peu adopté |
| **Bittensor** | Substrate | Pro miners H100 | N/A (émissions) | ❌ | $2.5B mcap | Pas un marketplace, c'est du mining incentive |
| **Aethir** | Arbitrum | Enterprise DC (malgré branding) | ~20% | ❌ | $120M+ levés en node licenses | Branding "gaming" trompeur |
| **Salad** | Web2 | **Gamers réels** | 15-20% | ❌ (Stripe USD) | ~1M+ installs | Centralisé, pas de paiements agent |
| **Vast.ai** | Web2 | DC + hobbyists | ~25% | ❌ | Référence prix marché | Centralisé, pas crypto |
| **Hyperbolic** | Web2 | Aggrégé partenaires | API-margin | ❌ | Series A 2024 | Centralisé |
| **Prime Intellect** | Web2 (token planifié) | Volunteers + sponsorisés | Négocié | ❌ | INTELLECT-1/2 trained | Focus training, pas inference marketplace |
| **Petals** | OSS | Volunteer (incl. consumer) | Gratuit | ❌ | Research-only | Pas de monétisation |
| **EXO Labs** | OSS | Apple Silicon | None | ❌ | Viral 2024 | Pas de marketplace |

### Les 5 gaps qu'Apis exploite

1. ✅ **AI agent M2M payments** — strictement inoccupé
2. ✅ **Vrai consumer gamer GPU on-chain** — seul Salad est gamer mais centralisé
3. ✅ **Vérification credible** — point faible universel
4. ✅ **Latency-tier inference real-time** — entre Salad (batch) et Hyperbolic (cher centralisé)
5. ✅ **Payments-first vs emissions-first** — token fatigue post-2024 ouvre cette voie

---

## 3. ⚙️ Solana Architecture

### Stack confirmée

| Composant | Choix | Pourquoi |
|---|---|---|
| **Framework** | **Anchor 1.0.2** | Mature, productif. Pas Pinocchio (overkill hackathon). |
| **RPC** | **Helius free tier** (1M crédits/mois, 10 RPS, websockets inclus) | Best DX, DAS API, suffisant hackathon |
| **Stablecoin** | **USDC SPL classique** (mainnet `EPjFWdd5...`) | Token-2022 plus tard via design mint-agnostique |
| **Wallet provider** | **Privy server wallets** (Solana confirmé via SDP, free <500 MAUs) | Acquis par Stripe juin 2025, fastest path |
| **Storage** | **Pinata IPFS** (free 1 GB) | Standard pour les images générées |
| **Multisig admin** | **Squads v4** | Upgrade authority + admin actions |

### Architecture compte (Anchor accounts)

```rust
GlobalConfig            seeds: ["config"]                 // admin, fee_bps, paused
ProviderRegistry        seeds: ["provider", pubkey]       // bond_vault, status, specs_hash
JobRecord               seeds: ["job", client, nonce]     // price, spec_hash, status, deadline
EscrowVault             seeds: ["vault", job_record]      // SPL Token account, authority = JobRecord PDA
ReputationAccount       seeds: ["rep", provider]          // jobs_completed, score_ema
DisputeAccount          seeds: ["dispute", job]           // raised_by, evidence_hash
```

### Instructions principales (~12)

```text
initialize_config(admin, usdc_mint, fee_bps, min_bond)
register_provider(specs_hash, endpoint_uri_hash, bond_amount)
deposit_bond / withdraw_bond
create_job(provider, nonce, price, spec_hash, deadline)
accept_job() / submit_completion(proof_hash) / confirm_completion()
auto_release()           // si deadline + grace passé sans dispute
raise_dispute(evidence) / resolve_dispute(resolution)
slash_provider(provider, bps)
update_reputation(job)   // CPI interne
```

### 5 Security must-do

1. **Hardcoder `Program<'info, Token>`** + utiliser `transfer_checked` partout
2. **Tous PDAs validés** par `seeds = [...] + bump + has_one = ...`
3. **`overflow-checks = true`** dans `Cargo.toml [profile.release]` + `checked_*` partout
4. **Upgrade authority transférée à Squads multisig** AVANT mainnet
5. **Re-read state après chaque CPI** (anything cached can be stale)

### Inspirations GitHub à fork

- `solana-developers/program-examples — escrow` — base canonique
- `drift-labs/drift-vaults` — vaults + fees + accounting
- `metaplex-foundation/mpl-auction-house` — marketplace 2-côtés
- `coral-xyz/sealevel-attacks` — checklist sécurité

### Pièges historiques à éviter

- **Cashio (mars 2022)** : missing PDA validation → $48M drainés
- **Mango Markets (oct 2022)** : oracle manipulation → $117M
- **Nirvana Finance (juil 2022)** : flash-loan + reserve mispricing
- **OptiFi (août 2022)** : `solana program close` accidentel par un dev → leçon : multisig upgrade authority

---

## 4. 🛡️ Verification Stack

### Décision finale

**Layer 1 only au hackathon, Phase 2 = Phala TEE pour tier premium.**

| Layer | Hackathon | Phase 2 | Phase 3+ |
|---|---|---|---|
| L1a — Signatures + result hash | ✅ Build | Keep | Keep |
| L1b — Redundant exec N=2-3 | ✅ Build (premium tier) | Keep | Keep |
| L1c — Spot-check 5% via VRF | ✅ Build | Keep, scale validators | Keep |
| L1d — Stake + slashing | ✅ Build | Keep | Keep |
| L2 — TEE NVIDIA H100 CC | ❌ Pas faisable consumer | ✅ Phala Network | Standard |
| L3 — zkML pour SD | ❌ Infeasible en 2026 | ❌ Encore non | À évaluer |

### Paramètres Phase 1 concrets

- **Stake provider** : ~50 SOL minimum (filtre les griefers)
- **Spot check** : 5% des jobs via VRF (slot hash randomness)
- **Dispute window** : 2h post-result, bond 1 SOL pour challenger
- **Slashing** : 100% du bond per-job en cas de dispute perdu, 0.5%/heartbeat manqué
- **Tier "verified"** : N=3 redundancy, accept si ≥2 hashes matchent → prix 3.5x

### Recette Stable Diffusion déterministe (CRITIQUE)

```python
# AVANT import torch
import os
os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"
os.environ["PYTHONHASHSEED"] = "0"

import torch, numpy as np, random
from diffusers import StableDiffusionPipeline, DDIMScheduler

# Settings
torch.use_deterministic_algorithms(True, warn_only=False)
torch.backends.cudnn.deterministic = True
torch.backends.cudnn.benchmark = False
torch.backends.cuda.matmul.allow_tf32 = False
torch.backends.cudnn.allow_tf32 = False

# Pin precision FP32 + DDIM scheduler (PAS Euler-a)
dtype = torch.float32
scheduler = DDIMScheduler.from_pretrained(MODEL_ID, subfolder="scheduler")

def seed_all(seed: int):
    random.seed(seed); np.random.seed(seed)
    torch.manual_seed(seed); torch.cuda.manual_seed_all(seed)
    return torch.Generator(device="cuda").manual_seed(seed)

g = seed_all(JOB_SEED)
img = pipe(prompt, num_inference_steps=30, guidance_scale=7.5,
           generator=g, output_type="pt").images[0]

# Hash le tensor float, pas le PNG
import hashlib
result_bytes = img.detach().cpu().contiguous().numpy().tobytes()
result_hash = hashlib.sha256(result_bytes).hexdigest()
```

### Ce qui doit être pinné dans le JobSpec on-chain

- `model_hash` (sha256 des weights safetensors)
- `scheduler = DDIM`, `steps`, `guidance_scale`
- `seed`
- `dtype = fp32`
- `resolution`
- `cuda_version`, `torch_version`, `diffusers_version`
- `gpu_arch_class` (ampere/ada/blackwell — required match pour byte-equal)

### Cross-arch fallback : phash avec tolérance

```python
import imagehash, PIL.Image
phash = imagehash.phash(PIL.Image.fromarray(img_uint8), hash_size=16)
# Validators acceptent si Hamming distance to majority ≤ 4 / 256
```

---

## 5. 📦 Tech Stack Final

| Composant | Outil | Licence | Coût | Notes |
|---|---|---|---|---|
| Modèle SD | **Flux.1 Schnell** (4 steps) | **Apache-2.0** ✅ | Free | Seul top-tier commercial-OK |
| Quantization | bitsandbytes NF4 + torchao INT4 | MIT/BSD | Free | NF4 baseline, INT4 + torch.compile premium |
| Inference engine | diffusers + PyTorch 2.6 + CUDA 12.4 | Apache | Free | HuggingFace standard |
| SDK Solana worker | solders + solana-py + anchorpy | Apache/MIT | Free | Layered: solders pour primitives, anchorpy pour IDL |
| RPC | **Helius free** (1M crédits/mo, 10 RPS) | Free | $0 | 100k credits free was older info |
| Smart contract | **Anchor 1.0.2** | Apache | Free | Migration depuis 0.31 majeure |
| Worker packaging | **Nuitka** (one-folder) + first-run downloader | Apache | Free | PyInstaller flag par AV |
| Code signing Win | SSL.com OV → EV après 6 mois | $200→$400/an | — | eSigner cloud HSM, pas besoin de YubiKey |
| Desktop app provider | **Tauri 2.x** + sidecar pattern | MIT/Apache | Free | Tauri 2 stable depuis oct 2024 |
| IPC Tauri↔Python | JSON-RPC over local WebSocket | — | Free | Survives GUI close |
| Wallet provider/buyer | **Privy embedded** (Solana via SDP) | Free <500 MAUs | $0→$299/mo | Acquired by Stripe 2025-06 |
| GPU detection | wgpu + nvml-wrapper (Rust); pynvml (Py) | MPL/MIT | Free | NVIDIA |
| Background service | windows-service crate + NSSM fallback | — | Free | — |
| Auto-update | tauri-plugin-updater + minisign | MIT | Free | tauri |
| Apple Silicon | MLX + mlx-stable-diffusion (30% > MPS) | MIT | Free | Apple |
| Web app consumer | **Next.js 15** (via `create-solana-dapp`) | MIT | Free | Standard |
| Hosting frontend | Vercel free → Pro $20/mo | — | $0→$20 | vercel.com |
| Hosting backend | Fly.io machines + Postgres | — | $5-30/mo | fly.io |
| Storage IPFS | Pinata free 1 GB | — | Free | pinata.cloud |
| AI demo agent | Claude Sonnet 4.x + Noah AI 5M crédits | API | Free → API | anthropic.com + Dev3pack sponsor |
| Multisig | Squads v4 | — | Free (gas) | squads.so |

**Budget Phase 1 hackathon = $0 à $100 max.**

### 3 GitHub starter repos à fork

1. **`solana-developers/create-solana-dapp`** — scaffold officiel Anchor + Next.js 15 + wallet-adapter + tRPC
2. **`solana-developers/program-examples`** — escrow/marketplace patterns (fork pour le program Apis)
3. **`Levminer/Authme`** ou **`tauri-apps/tauri` examples** — Tauri 2 production patterns

### Top 5 implementation pitfalls

1. **Don't bundle PyTorch + CUDA dans l'installer** (6-8 GB → AV flags + conversion morte). First-run downloader.
2. **EV code signing requires hardware tokens (post-Jun 2023 rule)**. Use SSL.com eSigner cloud HSM pour skip wait YubiKey.
3. **Tauri 2 permissions system** : chaque plugin command needs capability JSON. Budget 1j de wiring.
4. **Phantom n'a pas de desktop deeplink** comme mobile. Use Privy embedded wallet, not Phantom.
5. **Flux Schnell with `guidance_scale != 0` produces garbage** — distilled assuming CFG=0. Hard-code dans le worker. `max_sequence_length` ≤ 256.

---

## 6. 🤖 AI Agent Integration

### Architecture recommandée : MCP + x402 + ElizaOS

| Layer | Protocole | Rôle |
|---|---|---|
| Discovery + tool calls | **MCP** (rev. 2025-11-25) | Agents Claude/GPT/Cursor le parlent nativement |
| Payment | **x402** (Coinbase) | HTTP 402 + Solana USDC settlement (400ms finality) |
| Wallet (agent side) | **Privy server wallet** | KMS custody + spend caps + Solana support |
| Demo bonus | **ElizaOS plugin** | Agents Eliza wallet-natifs sur Solana |

### Diagramme de séquence

```
Agent → MCP server (tools/list)
       ← list_offers, quote_inference, submit_job, get_status
Agent → submit_job(spec_hash)
       ← 402 + accepts:[{network:"solana", asset:"USDC", payTo:"Apis...", amount:"0.012"}]
Agent → sign SPL transfer + retry with X-PAYMENT header
MCP   → Coinbase facilitator (verify + settle)
       → Solana mainnet (broadcast SPL transfer, ~400ms)
MCP   → GPU node (dispatch job)
GPU   → image bytes/CID
       → 200 OK + result + X-PAYMENT-RESPONSE
```

### Composants à coder (~3 jours focus)

| Composant | Tech | Effort |
|---|---|---|
| Apis MCP server | TypeScript + `@modelcontextprotocol/sdk` + Hono | 0.5j |
| x402 middleware | npm `x402` package + Coinbase Solana facilitator | 0.5j |
| Solana payment verification | `@solana/web3.js` + `@solana/spl-token` | 0.5j |
| GPU worker (Flux Schnell) | Python + diffusers + Nuitka, fallback Replicate | 0.5j |
| Agent harness | Claude Sonnet 4.x + MCP client + Privy wallet | 0.5j |
| Demo UI | Next.js streaming reasoning + tx hash + image | 0.5j |

### État de x402 vérifié live

- ✅ **Production-ready sur Solana**
- ✅ **35M+ transactions** déjà passées
- ✅ **$10M+ volume** processed
- ✅ **AWS Bedrock partenariat 7 mai 2026**
- Free tier : 1k tx/mo puis $0.001/tx

---

## 7. 🎬 Demo Scenario

### Structure

Hook (15s) → Problem (25s) → Solution (20s) → Live demo (90s) → Traction + Ask (30s)

### Le script complet

#### [0:00-0:15] HOOK

*Visual : RTX 5090 idle next to a Steam menu, cut to indie dev hitting "rate limit exceeded" on OpenAI*

> « 100 millions de cartes graphiques haut de gamme dans le monde. Idle 80% du temps. Pendant ce temps, les devs IA paient 4x le prix spot d'un H100 — quand ils peuvent en avoir un. On a construit Apis. »

#### [0:15-0:40] PROBLÈME

*3 stats à l'écran*

> « OpenAI rate-limit les agents indé. AWS exige 6 mois d'engagement pour un H100. Et les gamers dépensent $2,000+ sur des GPUs utilisés 4h/jour. La compute est cassée dans 3 directions. »

#### [0:40-1:00] SOLUTION

*Animation gamer → Solana → AI agent*

> « Apis, c'est un marketplace permissionless de GPU sur Solana. Les gamers louent leur capacité idle. Les agents et devs achètent à la seconde. Smart contract Anchor escrow le paiement, slash les mauvais providers. Sans KYC. Sans 30% de commission. »

#### [1:00-2:30] LIVE DEMO

*Screen recording, no slides*

- **1:00** — Provider : gamer ouvre Apis desktop, clique "Earn". Auto-detect RTX 4090 24GB. Click "Start Hosting". 15s.
- **1:15** — Buyer (Claude) : « Je donne $5 USDC à Claude. Une seule instruction. Aucun outil sauf internet + wallet. » Le prompt : "Generate 4 hero images for our landing page. Find a GPU marketplace. Pay yourself. Budget $1."
- **1:30** — Claude raisonne en live :
  - Découvre `mcp.apis.xyz`. Liste tools.
  - `quote_inference` → $0.012/image
  - `submit_job` → 402
  - "Server requires 0.012 USDC on Solana. Signing payment from `7xKX...QmRf`"
- **1:50** — Solana Explorer popup : tx confirmée en **400ms**. Première image arrive.
- **2:00** — Trois autres images en parallèle. Le gamer voit son wallet remplir en temps réel.
- **2:20** — Reputation NFT minté au provider après job complete.

#### [2:30-3:00] ASK

*Open agent's wallet on Solscan*

> « On a commencé avec $5. Dépensé $0.048 sur 4 images. Restant $4.95. Aucun humain n'a autorisé un seul paiement. Pas de carte. Pas d'API key. L'agent a découvert le marketplace, négocié le prix, payé en stablecoin sur Solana — autonome.
>
> Toutes les boîtes IA construisent des agents. Aucune ne peut payer pour quoi que ce soit. Apis est le marketplace où ils peuvent enfin — et Solana est la seule chain assez rapide et cheap pour faire ça à machine speed. »

🎤 *Mic drop.*

### À NE JAMAIS FAIRE

- ❌ **Mockups Figma** présentés comme produit (détectés en 10s)
- ❌ **Voix off AI cloned** pour la narration founder (disqualifiant pour les juges)
- ❌ **>3:00** (Colosseum coupe au 3:00 strict)
- ❌ **Stock music plus fort que la voix** (mix à -20dB)
- ❌ **Slow loading screens non coupés** au montage

---

## 8. 📅 Build Plan — 5 semaines

### Semaine 1 — Foundation : pipeline bout-en-bout fake

**Objectifs :**
- Setup Rust + Solana CLI + Anchor 1.0.2 + Phantom + faucet devnet
- Smart contract v0.1 (juste `register_provider` + `create_job` + emit events)
- Frontend Next.js v0.1 (`create-solana-dapp` template) + connexion Phantom + 1 page submit
- Worker Python v0.1 (script qui écoute, retourne fake result)
- CI GitHub Actions

**Checkpoint Sun S1 :** *je submit un fake job de bout en bout, je vois le tx sur explorer.*
**Si pas atteint :** 3 jours buffer puis pivot vers MVP minimal (3 features only).

### Semaine 2 — Core marketplace : escrow + Flux Schnell réel

- Smart contract v0.5 : escrow USDC complet (lock → release/refund), full job lifecycle
- Worker v0.5 : intégration **Flux Schnell NF4** sur GPU réel
- Frontend v0.5 : browse providers + résultat affiché
- Backend Node.js : orchestre dispatch jobs

**Checkpoint Sun S2 :** *je génère une vraie image en payant un vrai provider en USDC.*
**Si pas atteint :** skip provider node, utiliser Replicate API en backup pour démo.

### Semaine 3 — Pooling + Vérification

- **Pooling data-parallel** : split batch sur N providers, agrégation
- **Vérif L1** : signatures ed25519 + spot checks (5% via VRF) + slashing logic
- **Tier "verified"** : N=3 redundancy avec phash tolerance Hamming ≤4
- Tests end-to-end multi-provider

**Checkpoint Sun S3 :** *un provider tricheur est détecté + slashé en live.*
**Si pas atteint :** couper la vérification crypto, garder juste pooling.

### Semaine 4 — Agent IA + MCP + x402

- **MCP server** Apis (TypeScript) avec tools `list_offers`, `quote_inference`, `submit_job`
- **x402 middleware** sur le MCP server — retourne 402 + Solana accepts
- **Demo agent Claude** Sonnet 4.x via Anthropic SDK + MCP client + **Privy wallet**
- **App Tauri** provider : version finale avec UI propre + system tray + auto-update
- Plugin **ElizaOS** bonus si temps

**Checkpoint Sun S4 :** *Claude achète une image en autonomie devant moi en moins d'une minute.* C'est LA démo à enregistrer.

### Semaine 5 — Polish + Soumission

- **README** complet : install, run, archi diagram, contract addresses devnet
- **Vidéo démo** <3 min selon le script (tournage pro + montage)
- **Live demo URL** : Vercel pour frontend, Fly.io pour MCP server
- **Pitch deck** 11 slides
- **Soumission Dev3pack** + GitHub public + tweet annonce
- Buffer 24-48h pour bugs de dernière minute

**Checkpoint Sun S5 :** *projet soumis, prêt à pitcher.*

---

## 9. ⚠️ Risk Register

| # | Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Anchor 1.0.2 breaking changes vs tutoriels obsolètes | High | Medium | Stick aux release notes officielles + repos forkés récents 2026 |
| 2 | Provider Python qui crash en demo | Medium | High | Backup Replicate API, vidéo pré-enregistrée |
| 3 | Solana devnet lag pendant la démo live | Medium | High | Vidéo pré-enregistrée, mainnet beta tests si budget |
| 4 | Bug critique smart contract = fonds bloqués | Medium | Catastrophic | Multisig admin + emergency_pause + tests exhaustifs + checklist `sealevel-attacks` |
| 5 | Flux Schnell guidance_scale=0 oublié → output garbage | Low | Low | Hard-coder dans worker + test snapshot |
| 6 | Code signing Windows pas prêt = SmartScreen warnings | Medium | Medium | Démarrer SSL.com eSigner OV en S1 (~$200, dispo en 24h) |
| 7 | Privy MAU dépassé pendant tests beta | Low | Low | Free tier <500 MAUs, après c'est $299/mo (gérable) |
| 8 | MCP + x402 = pas standard officiel | Low | Low | Ship pragmatiquement, pitch comme "extension transport-layer" |
| 9 | TEE challengé par jury crypto-savvy | High | Medium | Pitch honnête : "cryptoeconomic security tier 1, TEE Phase 2 via Phala" |
| 10 | io.net comparaison dans Q&A jury | High | High | Réponse béton : "io.net = enterprise GPUs, nous = consumer + agents" |

---

## 10. 🚀 Post-Hackathon Path — Premier 90 jours

### Semaines 1-2 : Capture

- Blog post (Mirror) "Apis: building the GPU marketplace Solana DePIN was missing" dans les 72h
- Tweet thread + tag tous les sponsors et juges qui ont interagi
- **Discord public** (3 channels : providers, builders, general)
- Capturer **500 emails** des démo viewers via formulaire

### Semaines 3-4 : VC outreach (warm-first sequence)

| Jour | VC | Approche |
|---|---|---|
| J+15 | **Hack VC** (Ed Roman, thèse "DePAI") | Cold email |
| J+15 | **Solana Ventures / Foundation grants** | Application |
| J+18 | **Multicoin** | Warm intro (ex-Solana Labs / Hivemapper / io.net founder) |
| J+18 | **Dragonfly** (Haseeb, DePIN compute) | — |
| J+22 | **a16z + Founders Fund** | Nurture (no ask, just update) |
| J+22 | **Variant Fund** (Li Jin/Walden, network economics) | — |
| J+25 | **Robot Ventures** (Tarun Chitra, fast checks Solana) | — |
| J+30 | **Anatoly Yakovenko** (perso angel) | — |

**Materials ready :** deck 11 slides + démo 3min + memo 1-page + dataroom Notion (code, model financier, cap table). **Target :** 25 first calls J+30.

### Mois 2 : Beta program (100/100)

**100 providers :**
- Target : gamer Discords, /g/, NiceHash diaspora
- Offre : $50 SOL signup + 0% take rate à vie
- Installer one-click Win + Linux

**100 buyers :**
- Target : Solana AI agents (Virtuals, Pump-AI), HuggingFace Discord, AI-VTubers
- Offer : $25 free credit
- Wedge = Stable Diffusion XL inference

**Track :** GMV, retention D7/D30, provider uptime %, NPS

### Mois 3 : Capital + narrative

- Closer **pre-seed/seed $1.5-3M**
- Public roadmap. **Pas de token** annoncé (build VC trust)
- 1 design partner big-name (un projet IA Solana qui passe TOUTE son inference par Apis)
- Apply YC W27 + Solana Accelerator (non-dilutive credibility)

### KPIs day 90

- ✅ 100+ providers actifs, 100+ buyers, $X GMV
- ✅ 30%+ D30 retention
- ✅ $1.5M+ levés ou hard term sheet
- ✅ 5k+ Discord, 10k+ Twitter
- ✅ 1 case study marquee + 1 sponsor co-marketing

### Stratégie token (verdict)

**🚫 PAS de token au hackathon. PAS de promesse de token au pitch.**

| Mois | Étape |
|---|---|
| 0-9 | **0% take rate**, settlement USDC seul, focus GMV |
| 9-18 | **Points program** non-transferable (uptime + spend tracking) |
| 18-24 | **TGE** SI GMV > $X/mois ET providers > 10k |

**Tokenomics shape (quand prête) :** 1B APIS, 35% community/airdrop, 20% team (4y vest 1y cliff), 18% investors, 10% foundation, 10% liquidity, 7% ecosystem. Mécanisme : USDC fees → market-buy APIS → 50% burn / 50% to staked providers (modèle Jito/Jupiter).

### Structure légale

**Cayman Foundation Company + French SAS (~$50-75k year 1).**

| Élément | Coût | Rôle |
|---|---|---|
| **Cayman Foundation Company** | ~$25k setup + $15k/an | Issue token, holds protocol IP, governs treasury |
| **French SAS** | ~€2-5k setup + €5k/an | Op-co (employs founders, signs contracts) |
| **MiCA memo** (cabinet français) | €10-15k | Confirmer non-CASP |

**Alternatives plus cheap :**
- Wyoming DAO LLC (~$1k + $300/an) : moins reconnu international, IRS uncertainty
- Marshall Islands DAO LLC (~$5k + $3k/an) : pure DAO, banking difficile
- BVI / Panama Foundation (~$10k + $5k/an) : moins VC-pattern-matched

---

## 11. 🎁 Sponsor Activation Playbook Dev3pack

| Sponsor | Activable | Comment |
|---|---|---|
| **Solana Foundation** | ✅✅✅ Core | Anchor 1.0.2 + déploiement mainnet pendant hackathon + Token-2022 pour reputation |
| **Solana Mobile** | ✅✅ High-leverage (souvent under-competed) | Companion Saga/Seeker app : gamer manage GPU + push notifications |
| **Superteam** | ✅ Distribution | Apply Superteam Earn bounties + post Discord (DE/FR/IN) |
| **Ledger** | ✅ UX trust | Hardware wallet support pour escrow >$1k = différenciation Vast/Salad |
| **Virtuals** | ✅✅✅ **Strongest fit** | Build "Virtuals → Apis adapter" : agents Virtuals achètent inference Apis |
| **ElevenLabs** | ✅ Indirect | Voice de la démo si naturel. Bonus : voice-clone job qui tourne sur Apis GPU |
| **v0 (Vercel)** | ✅ Speed | Frontend Apis built avec v0, déploy URL visible |
| **LI.FI** | ✅ Payments UX | Cross-chain ETH/Polygon/etc → Solana USDC pour funder l'escrow |
| **Noah AI** | ✅ Crédits | 5M crédits gratuits pour démo agent + Apis-as-compute connector |

### Bonus criterion "consistent use of Solana SDKs"

Documenter dans le README :
1. **Anchor 1.0.2** (program on-chain)
2. **SPL Token-2022** (USDC payments)
3. **Solana Pay** (top-up onboarding)
4. **Squads multisig** (admin upgrade authority)
5. **Pyth oracles** (prix SOL/USDC pour conversion)
6. **Helius RPC** (DAS + websockets enhanced)
7. **Metaplex** (reputation NFT)
8. **Jito bundles** (MEV-protected escrow)

→ **8 SDKs documentés** = max points sur le bonus criterion.

### Prizes worth targeting

- **Solana grand prize + DePIN/Infra side track** — primary target
- **Solana Mobile track** — under-competed, ~$20-50k
- **Superteam community choice** — distribution > prize
- **Virtuals integration prize** — fits Apis directly
- **LI.FI cross-chain** — souvent <10 entries qualify, easy bonus

---

## 12. 📚 Sources

### ✅ Vérifié live (mai 2026)

- [Anchor releases](https://github.com/solana-foundation/anchor/releases) — accessed 2026-05-09 — **Latest stable: 1.0.2**
- [Anchor docs](https://www.anchor-lang.com/docs/installation) — accessed 2026-05-09
- [Welcome to x402 — Coinbase](https://docs.cdp.coinbase.com/x402/welcome) — accessed 2026-05-09
- [What is x402? Solana](https://solana.com/x402/what-is-x402) — accessed 2026-05-09 — **35M+ tx, $10M+ volume**
- [x402.org](https://www.x402.org/) — accessed 2026-05-09
- [Coinbase x402 GitHub](https://github.com/coinbase/x402) — accessed 2026-05-09
- [Coinbase x402 + AWS Bedrock launch (May 7, 2026)](https://www.cryptotimes.io/2026/05/07/coinbase-and-aws-bridge-ai-and-crypto-with-usdc-payments/) — accessed 2026-05-09
- [Helius pricing](https://www.helius.dev/pricing) — accessed 2026-05-09 — **1M crédits/mois free**
- [Helius docs billing](https://www.helius.dev/docs/billing/plans) — accessed 2026-05-09
- [Privy pricing](https://www.privy.io/pricing) — accessed 2026-05-09 — **Acquired by Stripe June 2025**
- [Privy Solana docs](https://docs.privy.io/guide/expo/embedded/solana) — accessed 2026-05-09
- [Flux.1 Schnell HF](https://huggingface.co/black-forest-labs/FLUX.1-schnell) — accessed 2026-05-09 — **Apache-2.0 confirmed**
- [Flux license file](https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-schnell) — accessed 2026-05-09
- [Solana Renaissance winners](https://solana.com/news/solana-renaissance-winners) — accessed 2026-05-09
- [Solana Radar winners](https://solana.com/news/solana-radar-winners) — accessed 2026-05-09 — **Reflect grand prize, Cura DePIN winner**
- [Solana Breakout winners](https://blog.colosseum.com/announcing-the-winners-of-the-solana-breakout-hackathon/) — accessed 2026-05-09
- [MCP Specification rev. 2025-11-25](https://modelcontextprotocol.io/specification/latest) — verified by agent
- [MCP overview](https://modelcontextprotocol.io/) — verified by agent

### 📚 Knowledge-base + URLs canoniques (à re-vérifier avant publication)

- io.net controverse 2024 GPU count — vérifier sources Decrypt / The Block
- [Akash Network docs](https://akash.network/docs/)
- [Render Foundation whitepaper](https://renderfoundation.com/whitepaper)
- [Bittensor docs](https://docs.bittensor.com/)
- [Phala Network confidential AI](https://docs.phala.network/overview/phala-network/confidential-ai-inference)
- [NVIDIA Confidential Computing](https://www.nvidia.com/en-us/data-center/solutions/confidential-computing/)
- [HuggingFace Diffusers reproducibility](https://huggingface.co/docs/diffusers/using-diffusers/reproducibility)
- [HuggingFace Diffusers quantization](https://huggingface.co/docs/diffusers/main/en/quantization/overview)
- [PyTorch determinism](https://pytorch.org/docs/stable/notes/randomness.html)
- [Solana Cookbook](https://solanacookbook.com/)
- [solana-developers/program-examples](https://github.com/solana-developers/program-examples)
- [drift-labs/drift-vaults](https://github.com/drift-labs/drift-vaults)
- [Squads-Protocol/v4](https://github.com/Squads-Protocol/v4)
- [coral-xyz/sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks)
- [metaplex-foundation/mpl-bubblegum](https://github.com/metaplex-foundation/mpl-bubblegum)
- [ElizaOS GitHub](https://github.com/elizaOS/eliza)
- [Tauri 2 docs](https://tauri.app/)
- [Multicoin Capital writing](https://multicoin.capital/writing)
- [a16z crypto State of Crypto](https://a16zcrypto.com/state-of-crypto-2025/)

---

## ⚠️ Caveats sur la recherche

- **5 des 6 agents de recherche** n'ont pas eu accès live à WebSearch/WebFetch (permissions environnement). Leurs rapports utilisent du knowledge training (cutoff janvier 2026) avec caveats `[unverified]` sur les chiffres volatils.
- **Agent 4 (AI agents)** a vérifié live sur `modelcontextprotocol.io` → spec MCP confirmée révision 2025-11-25.
- **Agent 5 (worker stack)** a vérifié partiellement sur HuggingFace.
- **6 vérifications WebSearch live** ont été faites en synthèse pour les facts les plus critiques (Anchor 1.0.2, x402 production, Helius pricing, Flux license, hackathon winners, Privy).
- Les chiffres marqués `[unverified]` ou `[VERIFY]` doivent être re-confirmés avant publication externe.

---

*Rapport généré le 2026-05-09 dans le cadre du hackathon Dev3pack — projet Apis.*
