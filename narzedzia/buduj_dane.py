"""Buduje pliki danych gry z list kategorii i polskiego słownika.

Wymaga: pip install wordfreq spylls
oraz plików słownika hunspell pl (np. z pakietu npm `dictionary-pl`):
    npm pack dictionary-pl && tar xzf dictionary-pl-*.tgz
    python narzedzia/buduj_dane.py --hunspell package/index

Wynik: dane/kategorie.js i dane/slownik.js
"""
import argparse
import json
import math
import re
import unicodedata
from pathlib import Path

from wordfreq import top_n_list, word_frequency, zipf_frequency

ROOT = Path(__file__).resolve().parent.parent
KAT_DIR = ROOT / "data" / "kategorie"
OUT_DIR = ROOT / "dane"

# Zakresy punktów dla poziomów popularności (1 = najczęstsze odpowiedzi).
TIERS = {1: (4, 24), 2: (28, 50), 3: (54, 78), 4: (82, 100)}

PACK_ORDER = ["jedzenie", "zwierzęta", "geografia", "natura", "dom", "ludzie", "kultura", "różne"]
POLISH = re.compile(r"^[a-ząćęłńóśźż]+$")


def norm(s: str) -> str:
    s = s.lower().replace("ł", "l")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def phrase_zipf(text: str) -> float:
    words = [w for w in re.split(r"[\s\-]+", text.lower()) if w]
    if not words:
        return 0.0
    if len(words) == 1:
        return zipf_frequency(words[0], "pl")
    # Wyrażenia wielowyrazowe są rzadsze niż ich najrzadszy wyraz.
    return min(zipf_frequency(w, "pl") for w in words) - 0.5


def parse_categories():
    cats = []
    for path in sorted(KAT_DIR.glob("*.txt")):
        cur = None
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("# "):
                continue
            if line.startswith("## "):
                q, pack = [p.strip() for p in line[3:].split("|")]
                cur = {"q": q, "pack": pack, "entries": [], "seen": set()}
                cats.append(cur)
                continue
            m = re.match(r"^([1-4]):\s*(.*)$", line)
            if not m or cur is None:
                continue
            tier = int(m.group(1))
            for item in m.group(2).split(","):
                item = item.strip()
                if not item:
                    continue
                forms = [f.strip() for f in item.split("/") if f.strip()]
                keys = [norm(f) for f in forms]
                keys = [k for k in keys if k]
                if not keys or any(k in cur["seen"] for k in keys):
                    continue
                cur["seen"].update(keys)
                cur["entries"].append({"forms": forms, "tier": tier})
    return cats


def score_categories(cats):
    out = []
    for c in cats:
        by_tier = {t: [] for t in TIERS}
        for e in c["entries"]:
            e["z"] = max(phrase_zipf(f) for f in e["forms"])
            by_tier[e["tier"]].append(e)
        rows = []
        for t, items in by_tier.items():
            lo, hi = TIERS[t]
            # W obrębie poziomu: częstsze słowo w języku = mniej punktów.
            items.sort(key=lambda e: -e["z"])
            n = len(items)
            for i, e in enumerate(items):
                pts = lo if n == 1 else round(lo + (hi - lo) * i / (n - 1))
                rows.append([e["forms"][0], pts] + e["forms"][1:])
        rows.sort(key=lambda r: r[1])
        out.append({"q": c["q"], "p": c["pack"], "w": rows})
    out.sort(key=lambda c: (PACK_ORDER.index(c["p"]) if c["p"] in PACK_ORDER else 99, c["q"]))
    return out


def is_adverb_of(w: str, adj: str) -> bool:
    if adj[-1:] not in ("y", "i") or len(adj) < 4:
        return False
    base = adj[:-1]
    return w in (base + "o", base + "ie", base + "e")


def lemma_frequencies(d, limit: int, cache: Path | None):
    if cache and cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    lemma_freq = {}
    words = top_n_list("pl", limit)
    for i, w in enumerate(words):
        if i % 50000 == 0:
            print(f"  {i}/{len(words)} słów, {len(lemma_freq)} haseł")
        if len(w) < 3 or not POLISH.match(w) or not d.lookup(w):
            continue
        stems = {f.stem for f in d.lookuper.good_forms(w)}
        stems = {s for s in stems if s and POLISH.match(s) and len(s) >= 3}
        if not stems:
            continue
        best = max(stems, key=lambda s: (word_frequency(s, "pl"), -len(s)))
        if is_adverb_of(w, best):
            best = w  # przysłówki (szybko, pięknie) liczymy osobno
        lemma_freq[best] = lemma_freq.get(best, 0.0) + word_frequency(w, "pl")
    if cache:
        cache.write_text(json.dumps(lemma_freq, ensure_ascii=False), encoding="utf-8")
    return lemma_freq


def build_dictionary(hunspell_base: str, limit: int, cache: Path | None):
    from spylls.hunspell import Dictionary

    d = Dictionary.from_files(hunspell_base)
    lemma_freq = lemma_frequencies(d, limit, cache)

    # Hasła podstawowe słownika (wpisy z flagami odmiany) - także te rzadkie.
    for line in Path(hunspell_base + ".dic").read_text(encoding="utf-8").splitlines()[1:]:
        w, _, flags = line.strip().partition("/")
        if flags and len(w) >= 3 and POLISH.match(w) and w not in lemma_freq:
            lemma_freq[w] = word_frequency(w, "pl")

    lemmas = {}
    for lemma, f in lemma_freq.items():
        if not re.search(r"[aąeęioóuy]", lemma):
            continue
        z = math.log10(f * 1e9) if f > 0 else 0
        lemmas[lemma] = round(z, 1)
    return lemmas


def front_code(items):
    """Kompresja posortowanej listy: litera = długość wspólnego przedrostka."""
    out, prev = [], ""
    for w, z in items:
        k = 0
        while k < min(len(w), len(prev), 25) and w[k] == prev[k]:
            k += 1
        out.append(f"{chr(65 + k)}{w[k:]}{min(99, max(0, int(z * 10))):02d}")
        prev = w
    return "".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hunspell", required=True, help="ścieżka bez rozszerzenia do .dic/.aff")
    ap.add_argument("--limit", type=int, default=400000)
    ap.add_argument("--cache", type=Path, help="plik JSON z częstościami (przyspiesza kolejne budowy)")
    args = ap.parse_args()

    OUT_DIR.mkdir(exist_ok=True)
    cats = score_categories(parse_categories())
    total = sum(len(c["w"]) for c in cats)
    (OUT_DIR / "kategorie.js").write_text(
        "window.KATEGORIE=" + json.dumps(cats, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Kategorie: {len(cats)}, odpowiedzi: {total}")

    lemmas = build_dictionary(args.hunspell, args.limit, args.cache)
    # Zapis zwarty: [przedrostek A-Z][reszta słowa][zipf*10 jako dwie cyfry].
    body = front_code(sorted(lemmas.items()))
    (OUT_DIR / "slownik.js").write_text(f'window.SLOWNIK="{body}";\n', encoding="utf-8")
    print(f"Słownik: {len(lemmas)} haseł")


if __name__ == "__main__":
    main()
