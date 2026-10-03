#!/usr/bin/env python3
"""Fetch the FH6 car list from Forza Wiki and export it for ForzaBot."""

from __future__ import annotations

import csv
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE_URL = "https://forza.fandom.com/wiki/Forza_Horizon_6/Cars"
OUTPUT_COLUMNS = ["Vehicle", "Value", "PI", "Availability"]
PI_RE = re.compile(r"\b(D|C|B|A|S[12]|R|X)\s*(\d{3})\b", re.I)
PRICE_RE = re.compile(r"([\d,]+)\s*(?:CR|credits?)", re.I)
YEAR_RE = re.compile(r"((?:19|20)\d{2})")


def clean_text(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split()).strip()


class WikiTableParser(HTMLParser):
    """Collect HTML table rows while preserving each cell as plain text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(clean_text("".join(self._cell)))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def parse_car_rows(html: str) -> list[dict[str, str]]:
    parser = WikiTableParser()
    parser.feed(html)
    cars: dict[str, dict[str, str]] = {}

    for cells in parser.rows:
        if len(cells) < 8:
            continue
        first_cell = clean_text(cells[0])
        year_matches = list(YEAR_RE.finditer(first_cell))
        if not year_matches:
            continue
        # The wiki appends availability directly after the model year, and some
        # model names themselves contain a four-digit number (for example BMW 2002).
        year_match = year_matches[-1]

        vehicle = clean_text(first_cell[: year_match.start()])
        year = year_match.group(1)
        availability = clean_text(first_cell[year_match.end() :]).strip(" \"'") or "unknown"
        price_match = next((match for cell in cells for match in [PRICE_RE.search(cell)] if match), None)
        pi_match = next((match for cell in reversed(cells) for match in [PI_RE.search(cell)] if match), None)
        if not vehicle or not pi_match:
            continue

        # The wiki lists the model year in the first cell; bot search expects it at the end.
        name = f"{vehicle} {year}"
        pi = f"{pi_match.group(1).upper()}{pi_match.group(2)}"
        cars[name] = {
            "Vehicle": name,
            "Value": price_match.group(1).replace(",", "") if price_match else "0",
            "PI": pi,
            "Availability": availability,
        }

    return sorted(cars.values(), key=lambda car: car["Vehicle"].casefold())


def download_html() -> str:
    request = Request(
        SOURCE_URL,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.google.com/",
            "DNT": "1",
            "Upgrade-Insecure-Requests": "1",
        },
    )
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def write_csv(rows: list[dict[str, str]], output_path: Path) -> None:
    if not rows:
        raise ValueError("No FH6 cars with a year and PI were found on Forza Wiki.")
    with output_path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    output_path = Path(sys.argv[1] if len(sys.argv) > 1 else "output.csv")
    rows = parse_car_rows(download_html())
    write_csv(rows, output_path)
    print(f"Wrote {len(rows)} FH6 cars to {output_path}")


if __name__ == "__main__":
    main()
