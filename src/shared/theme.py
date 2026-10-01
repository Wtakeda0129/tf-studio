"""Shared GARASU frame: fonts + theme CSS (appended to the page's last <style>) and the tool rail (inserted after <body>).
Used by every make_*.py:  from theme import apply;  html = apply(html, "fitter")"""
import pathlib
here = pathlib.Path(__file__).parent
TOOLS = [("learn", "learn.html", "Learn", '<path d="M4 6h7v13H4zM13 6h7v13h-7z"/>'),
         ("explorer", "explorer.html", "Lab", '<path d="M9 3v6l-5 10h16L15 9V3M8 3h8"/>'),
         ("fitter", "fitter.html", "Fitter", '<path d="M3 18c4 0 5-2 7-7s4-6 6-6 3 1 5 1M3 21h18"/>'),
         ("analysis", "analysis.html", "Data Analysis", '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>')]

def rail(active):
    cur = ' aria-current="page"'
    links = "".join(
        f'<a class="rtool{" on" if k == active else ""}" href="{f}" data-tool="{k}"{cur if k == active else ""}>'
        f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">{p}</svg>{n}</a>'
        for k, f, n, p in TOOLS)
    return (f'<nav class="rail" aria-label="Tools"><a class="logo" href="index.html" title="GARASU home"><img src="icon256.png" alt="GARASU home"></a>'
            f'<span class="rb">Beta</span>{links}</nav>')

def css():
    return (here / "fonts.css").read_text() + (here / "theme.css").read_text()

def apply(html, active):
    i = html.rfind("</style>")
    assert i > 0, "no <style> block"
    html = html[:i] + "\n" + css() + html[i:]
    j = html.find("<body")
    k = html.find(">", j) + 1
    return html[:k] + "\n" + rail(active) + html[k:]
