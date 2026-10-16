"""Wycina z index.html fragment między znacznikami ARTIFACT-START/END,
żeby opublikować grę jako stronę (Artifact) bez własnego <html>/<head>."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "index.html").read_text(encoding="utf-8")
start = src.index("<!--ARTIFACT-START-->") + len("<!--ARTIFACT-START-->")
end = src.index("<!--ARTIFACT-END-->")
out = ROOT / "dist" / "artefakt.html"
out.parent.mkdir(exist_ok=True)
out.write_text(src[start:end].strip() + "\n", encoding="utf-8")
print(out)
