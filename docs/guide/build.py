#!/usr/bin/env python3
"""Build the illustrated user guides (docs/user-guide-sv.pdf, -en.pdf).

Layout is a tiny flow engine that emits one A4 SVG per page; rsvg-convert turns
the page list into a single PDF (`rsvg-convert -f pdf page1.svg page2.svg ...`).

Screenshots live in docs/guide/img/<lang>/ and are captured from the real UI:
run `npm run dev:mock` (Tauri IPC is faked by src/mockIpc.ts) and screenshot the
browser. Re-capture a file and re-run this script when the UI changes.

Usage: python3 docs/guide/build.py
"""

from __future__ import annotations

import base64
import html
import mimetypes
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUIDE = ROOT / "docs" / "guide"
BUILD = GUIDE / "build"

# A4 in points.
W, H = 595.0, 842.0
MARGIN = 46.0
CONTENT_W = W - 2 * MARGIN
FOOTER_Y = H - 28.0

INK = "#1b2733"
MUTED = "#5b6b7a"
ACCENT = "#2f6f8f"
MARK = "#e8574a"
RULE = "#d4dbe2"
FONT = "Helvetica, Arial, sans-serif"

# Rough average glyph width as a fraction of font size (Helvetica).
CHAR_W = 0.50


def data_uri(path: Path) -> str:
    """rsvg-convert does not follow external file references, so every image is
    inlined as a data: URI."""
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def wrap(text: str, size: float, width: float) -> list[str]:
    budget = max(8, int(width / (size * CHAR_W)))
    words, lines, cur = text.split(), [], ""
    for word in words:
        cand = f"{cur} {word}".strip()
        if len(cand) <= budget:
            cur = cand
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


# ── Content blocks ───────────────────────────────────────────────────────────


@dataclass
class Block:
    kind: str
    text: str = ""
    items: list[str] = field(default_factory=list)
    img: str = ""
    callouts: list[tuple[float, float, str]] = field(default_factory=list)
    height: float = 0.0


def h1(t): return Block("h1", t)
def h2(t): return Block("h2", t)
def p(t): return Block("p", t)
def bullets(items): return Block("bullets", items=list(items))
def note(t): return Block("note", t)
def figure(img, caption="", callouts=(), height=250.0):
    return Block("figure", text=caption, img=img, callouts=list(callouts), height=height)
def steps(items): return Block("steps", items=list(items))
def pagebreak(): return Block("pagebreak")


# ── Renderer ─────────────────────────────────────────────────────────────────


class PageWriter:
    def __init__(self, lang: str, title: str, img_dir: Path):
        self.lang = lang
        self.title = title
        self.img_dir = img_dir
        self.pages: list[list[str]] = []
        self.parts: list[str] = []
        self.y = MARGIN + 30.0
        self.step_no = 0

    # -- page plumbing --

    def new_page(self):
        if self.parts:
            self.pages.append(self.parts)
        self.parts = []
        self.y = MARGIN + 34.0

    def need(self, h: float):
        if self.y + h > FOOTER_Y - 18.0:
            self.new_page()

    def text(self, s: str, x: float, y: float, size: float, fill=INK, weight="normal", anchor="start"):
        self.parts.append(
            f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" '
            f'fill="{fill}" font-weight="{weight}" text-anchor="{anchor}">{esc(s)}</text>'
        )

    # -- blocks --

    def render(self, blocks: list[Block]):
        for b in blocks:
            getattr(self, f"_{b.kind}")(b)
        self.new_page()

    def _pagebreak(self, _b):
        self.new_page()

    def _h1(self, b):
        self.need(46)
        self.y += 6
        self.text(b.text, MARGIN, self.y + 16, 21, ACCENT, "bold")
        self.y += 26
        self.parts.append(
            f'<rect x="{MARGIN}" y="{self.y:.1f}" width="{CONTENT_W}" height="2.5" fill="{ACCENT}"/>'
        )
        self.y += 16
        self.step_no = 0

    def _h2(self, b):
        # Reserve room for a first line of whatever follows, so a heading never
        # sits alone at the foot of a page.
        self.need(120)
        self.y += 8
        self.text(b.text, MARGIN, self.y + 12, 13.5, INK, "bold")
        self.y += 22
        self.step_no = 0

    def _p(self, b):
        lines = wrap(b.text, 10, CONTENT_W)
        self.need(len(lines) * 14 + 6)
        for line in lines:
            self.text(line, MARGIN, self.y + 10, 10, INK)
            self.y += 14
        self.y += 5

    def _bullets(self, b):
        for item in b.items:
            lines = wrap(item, 10, CONTENT_W - 14)
            self.need(len(lines) * 14 + 3)
            self.parts.append(
                f'<circle cx="{MARGIN + 3:.1f}" cy="{self.y + 6:.1f}" r="2.2" fill="{ACCENT}"/>'
            )
            for i, line in enumerate(lines):
                self.text(line, MARGIN + 14, self.y + 10, 10, INK)
                self.y += 14
            self.y += 2
        self.y += 4

    def _steps(self, b):
        for item in b.items:
            self.step_no += 1
            lines = wrap(item, 10, CONTENT_W - 26)
            self.need(len(lines) * 14 + 6)
            self.parts.append(
                f'<circle cx="{MARGIN + 8:.1f}" cy="{self.y + 6:.1f}" r="8" fill="{MARK}"/>'
            )
            self.text(str(self.step_no), MARGIN + 8, self.y + 9.5, 9, "#ffffff", "bold", "middle")
            for line in lines:
                self.text(line, MARGIN + 26, self.y + 10, 10, INK)
                self.y += 14
            self.y += 4
        self.y += 4

    def _note(self, b):
        lines = wrap(b.text, 9.5, CONTENT_W - 26)
        box_h = len(lines) * 13 + 14
        self.need(box_h + 8)
        self.parts.append(
            f'<rect x="{MARGIN}" y="{self.y:.1f}" width="{CONTENT_W}" height="{box_h:.1f}" '
            f'rx="6" fill="#eef3f7"/>'
            f'<rect x="{MARGIN}" y="{self.y:.1f}" width="4" height="{box_h:.1f}" rx="2" fill="{ACCENT}"/>'
        )
        yy = self.y + 16
        for line in lines:
            self.text(line, MARGIN + 16, yy, 9.5, INK)
            yy += 13
        self.y += box_h + 10

    def _figure(self, b):
        path = self.img_dir / b.img
        if not path.exists():
            raise SystemExit(f"missing screenshot: {path}")
        # Screenshots are 1432x~835 → keep that aspect.
        w = CONTENT_W
        h = b.height
        cap_lines = wrap(b.text, 9, CONTENT_W) if b.text else []
        self.need(h + len(cap_lines) * 12 + 16)
        href = data_uri(path)
        self.parts.append(
            f'<image x="{MARGIN}" y="{self.y:.1f}" width="{w:.1f}" height="{h:.1f}" '
            f'xlink:href="{href}" href="{href}" preserveAspectRatio="xMidYMin meet"/>'
            f'<rect x="{MARGIN}" y="{self.y:.1f}" width="{w:.1f}" height="{h:.1f}" '
            f'fill="none" stroke="{RULE}" rx="4"/>'
        )
        for fx, fy, label in b.callouts:
            cx = MARGIN + fx * w
            cy = self.y + fy * h
            self.parts.append(
                f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="10" fill="{MARK}" stroke="#ffffff" stroke-width="2"/>'
            )
            self.text(label, cx, cy + 3.5, 10, "#ffffff", "bold", "middle")
        self.y += h + 6
        self.step_no = 0
        for line in cap_lines:
            self.text(line, MARGIN, self.y + 9, 9, MUTED)
            self.y += 12
        self.y += 8

    # -- output --

    def svg_pages(self) -> list[str]:
        out = []
        total = len(self.pages)
        for i, parts in enumerate(self.pages, start=1):
            header = (
                f'<text x="{MARGIN}" y="{MARGIN - 12}" font-family="{FONT}" font-size="8.5" '
                f'fill="{MUTED}">{esc(self.title)}</text>'
                f'<rect x="{MARGIN}" y="{MARGIN - 6}" width="{CONTENT_W}" height="0.8" fill="{RULE}"/>'
            )
            footer = (
                f'<text x="{W - MARGIN}" y="{FOOTER_Y}" font-family="{FONT}" font-size="8.5" '
                f'fill="{MUTED}" text-anchor="end">{i} / {total}</text>'
            )
            body = "".join(parts)
            out.append(
                f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
                f'width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
                f'<rect width="{W}" height="{H}" fill="#ffffff"/>'
                f'{"" if i == 1 else header}{body}{footer}</svg>'
            )
        return out


def cover(lang: str, title: str, subtitle: str, toc: list[str]) -> list[str]:
    """First page: icon, title, table of contents."""
    icon = data_uri(ROOT / "src-tauri" / "icons" / "icon.svg")
    rows = "".join(
        f'<text x="{MARGIN + 4}" y="{470 + i * 22}" font-family="{FONT}" font-size="11" fill="{INK}">'
        f'{esc(t)}</text>'
        for i, t in enumerate(toc)
    )
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
        f'<rect width="{W}" height="{H}" fill="#ffffff"/>'
        f'<image x="{MARGIN}" y="150" width="110" height="110" xlink:href="{icon}" href="{icon}"/>'
        f'<text x="{MARGIN}" y="320" font-family="{FONT}" font-size="30" font-weight="bold" fill="{ACCENT}">'
        f'{esc(title)}</text>'
        f'<text x="{MARGIN}" y="352" font-family="{FONT}" font-size="13" fill="{MUTED}">{esc(subtitle)}</text>'
        f'<rect x="{MARGIN}" y="420" width="{CONTENT_W}" height="2" fill="{ACCENT}"/>'
        f'{rows}'
        f'<text x="{MARGIN}" y="{H - 60}" font-family="{FONT}" font-size="9" fill="{MUTED}">'
        f'github.com/webbson/shooting-range-log</text>'
        f'</svg>'
    ]


def build(lang: str, spec) -> Path:
    BUILD.mkdir(parents=True, exist_ok=True)
    writer = PageWriter(lang, spec["title"], GUIDE / "img" / lang)
    writer.render(spec["blocks"])
    pages = cover(lang, spec["title"], spec["subtitle"], spec["toc"]) + writer.svg_pages()

    files = []
    for i, svg in enumerate(pages, start=1):
        f = BUILD / f"{lang}-{i:02d}.svg"
        f.write_text(svg, encoding="utf-8")
        files.append(f)

    out = ROOT / "docs" / f"user-guide-{lang}.pdf"
    subprocess.run(
        ["rsvg-convert", "-f", "pdf", "-o", str(out), *[str(f) for f in files]],
        check=True,
    )
    for f in files:
        f.unlink()
    return out


def main():
    sys.path.insert(0, str(GUIDE))
    from content import CONTENT  # noqa: E402  (content lives next to this script)

    for lang, spec in CONTENT.items():
        out = build(lang, spec)
        print(f"{out.relative_to(ROOT)}  ({out.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
