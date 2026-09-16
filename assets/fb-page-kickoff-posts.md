# Pocket Lota FB Page — branding assets & kickoff posts (issue #12 prep)

**Prepared:** 2026-09-13 · **Page:** Pocket Lota (61593583395478) · **Repo:** PRTLCTRL/finza-ops
**Waitlist CTA destination:** https://pocket-lota-ad.prtl.workers.dev (only permitted URL)

---

## 1. Profile icon — `assets/lota-icon-v1.png`

| Property | Value |
|---|---|
| File | `assets/lota-icon-v1.png` (this repo) |
| Size | 1024×1024 px (square, exceeds 800×800 requirement; safe for FB circular mobile crop) |
| Model | OpenAI `gpt-image-1`, quality `high` |
| Generator script | `scripts/gen_lota_icon.py` (reproducible; reads `OPENAI_API_KEY` from `~/.env`) |
| Design | Lota Lemon mascot only — single mustard-yellow lemon character, dark moody charcoal background |

### Prompt design choices (brand-lock driven)
- **Mascot-only composition.** No vessel in frame at all. The first AI test still
  (2026-09-13, pocket-lota-ad workflow log §3.4) failed the not-a-drink-flask
  lock — domed cap + glassy gooseneck spout read as thermos/teapot. Removing
  the product from the icon eliminates that failure mode entirely.
- **Negative constraints in-prompt:** "no bottles, no flasks, no cups, no
  thermoses, no spouts, no caps, no vessels of any kind", plus no text/watermarks.
- **Brand colors:** mustard-yellow character (product color) on dark moody
  charcoal background with warm spotlight — matches the ads' look.
- **Female read (ticket #6):** long eyelashes, soft confident smile, rosy cheeks.
- **Circular-crop safety:** generous empty margin around the character.
- **No caps/rim hardware:** leaf-stem top instead of any lid-like element.

### Verification status: PASSED (2026-09-15, orchestrator vision check)
All brand locks clean: lemon-character read (not a flask/thermos/teapot —
mascot-only, no vessel in frame), no caps/spouts, no text, no bowl/body
imagery, circular-crop safe at small sizes, clear-but-tasteful female read.
Verdict: **approved as Facebook profile icon** — pending only Arsal's
confirm on the lemon-as-brand-mark direction before upload.

**Reference assets for comparison:** `pocket-lota-ad/pmax-assets/logo-600.jpg`
(current 600×600 lemon mark), `pocket-lota-ad/public/lota-lemon.png` (mascot
reference). Existing inventory: `square-1024.jpg`, `landscape-1536x804.jpg`
(PMax), `lota-pour.png` (1400²), `lota-stowed.png` (1080²), `lota-jacket.jpg`
(1080²), plus imply-stills (`lota-hero-imply.jpg`, `lota-purse.jpg`,
`lota-nightstand.jpg`, `lota-tote.jpg`) and reels/shorts in `/public` + `/shorts`.

---

## 2. Kickoff post captions (text only — draft, NOT published)

**Status 2026-09-16 (swarm run):** icon PASSED brand locks (see §1) and the
page trust floor is already live since Sep 15 — avatar (lota-lemon) + cover
(`pocket-lota-ad/fb-page/fb-cover-final2.jpg`, 1640×624, uploaded + verified
via screenshot) + bio with waitlist URL. This file now covers **all five
caption drafts**; remaining agent-side work on the ticket is nil.
Publishing (avatar switch to lota-icon-v1 + 5 posts via composer) = Arsal's
explicit go. Cover deliverable = done in pocket-lota-ad repo.

Tone: problem-first (matches the live ads/reels), modern young corporate /
gender-neutral washroom vibe, women equal weight, purse/tote framing preferred
(Arsal, Sep 12). No medical claims, no explicit language, imply-only — no
bowl/body references. CTA always the waitlist ("first batch FOR FREE").

### Post 1 — "The design flaw"
> Paper's over there. You're stuck.
>
> Every washroom has the same design flaw — and nobody talks about it. Pocket
> Lota is a pocket-sized personal hygiene pour vessel that lives in your purse
> or backpack. Quiet, quick, and nobody ever knows it's there.
>
> Your personal bidet. Pocket-sized.
>
> Sign up to receive the first batch FOR FREE:
> https://pocket-lota-ad.prtl.workers.dev

### Post 2 — "Your bag already carries everything else"
> Your bag already carries everything else.
>
> Keys. Phone. Charger. The one thing it can't carry yet is peace of mind when
> the washroom lets you down. Pocket Lota fixes that — a pocket-sized hygiene
> pour vessel, ready before you leave the stall.
>
> Your personal bidet. Pocket-sized.
>
> Join the waitlist — first batch FOR FREE:
> https://pocket-lota-ad.prtl.workers.dev

### Post 3 — "Introducing"
> Introducing Pocket Lota.
>
> It looks like a flask. It's not. It's a pocket-sized personal hygiene pour
> vessel, built for the moment every washroom visit goes sideways. Fill. Pour.
> Refreshed. Restow. Nobody has to know.
>
> Your personal bidet. Pocket-sized.
>
> Sign up to receive the first batch FOR FREE:
> https://pocket-lota-ad.prtl.workers.dev

### Post 4 — "The office day" (research angle: 9–5 washroom agitation, UGC POV tone)
> Day 3 of the office washroom situation.
>
> The stall's out of paper AGAIN. You're improvising with single-ply and
> regret. There's a better move: Pocket Lota — a pocket-sized hygiene pour
> vessel that lives in your tote, weighs less than your keys, and turns any
> washroom into a clean exit. Fill. Pour. Refreshed. Restow. Your coworkers
> will never know.
>
> Your personal bidet. Pocket-sized.
>
> Join the waitlist — first batch FOR FREE:
> https://pocket-lota-ad.prtl.workers.dev

### Post 5 — "It has a name" (research angle: heritage lota, respectful nod)
> Your grandmother knew it as a lota. We just made it pocket-sized.
>
> The ritual is generations old. The washroom you're doing it in is not.
> Pocket Lota is a modern pour vessel for an old habit — quiet, discreet,
> and always in your bag before you leave the house. Some things are worth
> carrying forward. Literally.
>
> Your personal bidet. Pocket-sized.
>
> Sign up to receive the first batch FOR FREE:
> https://pocket-lota-ad.prtl.workers.dev

### Caption compliance check
- ✅ Problem-first openers (Post 1 mirrors the live ad line "Paper's over there. You're stuck.")
- ✅ "Introducing Pocket Lota" closer kept as a post (brand lock: close with it)
- ✅ Waitlist CTA + only-permitted URL; no checkout/price talk
- ✅ No medical claims (no health/germ/infection language)
- ✅ No explicit language; imply-only (washroom/stall level, no bowl/body)
- ✅ Never marketed as a drink flask (Post 3 actively disclaims it)
- ✅ Doesn't open with "lota"; wordmark intact
- ✅ Purse/backpack framing (preferred direction), no jacket-pocket-only framing
- ✅ (Posts 4–5) No medical/health claims, imply-only washroom level, heritage
  Post 5 keeps a respectful tone — no religious claims or practices described