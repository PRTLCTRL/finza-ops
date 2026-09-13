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

### ⚠️ Verification status: PENDING
No vision tool was available in this session. The image has **not** been
vision-checked against the brand locks. Before upload to the Page, verify:
- [ ] Reads as a lemon character, not a flask/thermos/teapot (lock: never drink-flask)
- [ ] No caps, spouts, or vessel hardware in frame
- [ ] No text/letters (wordmark stays Pocket Lota elsewhere)
- [ ] No toilet/bowl/body imagery (imply-only staging)
- [ ] Legible at 40×40 px and in circular crop
- [ ] Female read is clear but tasteful

**Reference assets for comparison:** `pocket-lota-ad/pmax-assets/logo-600.jpg`
(current 600×600 lemon mark), `pocket-lota-ad/public/lota-lemon.png` (mascot
reference). Existing inventory: `square-1024.jpg`, `landscape-1536x804.jpg`
(PMax), `lota-pour.png` (1400²), `lota-stowed.png` (1080²), `lota-jacket.jpg`
(1080²), plus imply-stills (`lota-hero-imply.jpg`, `lota-purse.jpg`,
`lota-nightstand.jpg`, `lota-tote.jpg`) and reels/shorts in `/public` + `/shorts`.

---

## 2. Kickoff post captions (text only — draft, NOT published)

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

### Caption compliance check
- ✅ Problem-first openers (Post 1 mirrors the live ad line "Paper's over there. You're stuck.")
- ✅ "Introducing Pocket Lota" closer kept as a post (brand lock: close with it)
- ✅ Waitlist CTA + only-permitted URL; no checkout/price talk
- ✅ No medical claims (no health/germ/infection language)
- ✅ No explicit language; imply-only (washroom/stall level, no bowl/body)
- ✅ Never marketed as a drink flask (Post 3 actively disclaims it)
- ✅ Doesn't open with "lota"; wordmark intact
- ✅ Purse/backpack framing (preferred direction), no jacket-pocket-only framing