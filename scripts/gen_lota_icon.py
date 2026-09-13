"""Generate Pocket Lota FB profile icon (Lota Lemon mascot) via gpt-image-1.

Brand-lock rationale (see prompt below):
- Mascot-only composition -> zero risk of drink-flask/teapot read (first AI
  still failed that lock; notes in pocket-lota-ad docs/ads-workflow-log.md 3.4).
- Mustard-yellow character on dark moody background -> brand colors.
- Female read via lashes + soft smile (ticket #6: female Lota Lemon).
- Generous margins -> survives FB circular mobile crop.
"""
import base64
import os
import sys

from openai import OpenAI

ENV_PATH = os.path.expanduser(r"C:\Users\Arsal\.env")
OUT_PATH = os.path.expanduser(r"C:\Users\Arsal\Projects\finza-ops\assets\lota-icon-v1.png")

PROMPT = (
    "A minimal flat vector-style brand mascot logo illustration: a friendly "
    "female lemon character for a personal care brand. One single bold "
    "mustard-yellow lemon, standing upright and centered, with a tiny green "
    "leaf stem on top, two simple dark dot eyes with long eyelashes, a soft "
    "confident smile, and subtle rosy cheeks. Charming, modern, "
    "corporate-clean startup mascot style. Dark moody charcoal background "
    "with a subtle warm spotlight glow behind the character. High contrast, "
    "clean smooth edges, generous empty margin around the character so it "
    "stays fully visible when cropped to a circle. Absolutely no text, no "
    "letters, no watermarks, no bottles, no flasks, no cups, no thermoses, "
    "no spouts, no caps, no vessels of any kind — only the lemon character."
)


def main() -> int:
    key = None
    with open(ENV_PATH, "r", encoding="utf-8-sig") as fh:
        for line in fh:
            s = line.strip()
            if s.startswith("export "):
                s = s[len("export "):]
            if s.startswith("OPENAI_API_KEY="):
                key = s.split("=", 1)[1].strip().strip('"').strip("'")
                break
    if not key:
        print("FATAL: OPENAI_API_KEY not found in", ENV_PATH)
        return 1

    client = OpenAI(api_key=key)
    print("Calling gpt-image-1 (1024x1024, high quality)...")
    resp = client.images.generate(
        model="gpt-image-1",
        prompt=PROMPT,
        size="1024x1024",
        quality="high",
        n=1,
    )
    b64 = resp.data[0].b64_json
    if not b64:
        print("FATAL: empty b64_json in response")
        return 1

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "wb") as fh:
        fh.write(base64.b64decode(b64))

    from PIL import Image
    im = Image.open(OUT_PATH)
    print("SAVED:", OUT_PATH)
    print("SIZE:", im.size, im.mode)
    return 0


if __name__ == "__main__":
    sys.exit(main())