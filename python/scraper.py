#!/usr/bin/env python3
"""
Robust FH5 car table extractor.

Fixes:
- Preserves ALL original columns (including car names)
- Safely removes only the "Lowest PI" column
- Converts price strings like "4,000,000 CRLEGENDARY" -> 4000000
- Expands AC / BR / HA acquisition codes only when applicable
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path
from typing import Dict, List

from bs4 import BeautifulSoup

PRICE_RE = re.compile(r"(\d[\d,]*)")

ACQUISITION_MAP = {
    "AC": "Arcade / Horizon Arcade",
    "BR": "Barn Find Reward",
    "HA": "Horizon Adventure Unlock",
}

METADATA_MARKERS = (
    "autoshow",
    "wheelspin",
    "gifted",
    "barn find",
    "car mastery",
    "car collector",
    "accolade",
    "promotional",
    "car pass",
    "horizon raptors",
    "dlc",
)


def clean_text(text: str) -> str:
    return " ".join(text.replace("\xa0", " ").split()).strip()


def parse_price(value: str) -> str:
    """Extract integer from price-like strings."""
    match = PRICE_RE.search(value)
    if not match:
        return value
    return match.group(1).replace(",", "")


def clean_vehicle_name(value: str) -> str:
    text = clean_text(value)
    if not text:
        return text

    text = re.sub(r"\(.*?\)", "", text)
    text = re.sub(r'".*?"', "", text)

    lower_text = text.lower()
    cut_index = None
    for marker in METADATA_MARKERS:
        idx = lower_text.find(marker)
        if idx != -1:
            cut_index = idx if cut_index is None else min(cut_index, idx)

    if cut_index is not None:
        text = text[:cut_index]

    text = text.replace(" ,", ",")
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r"\s+", " ", text).strip(" ,")
    return text


def maybe_expand_acquisition(header: str, value: str) -> str:
    """Only expand AC/BR/HA if column name implies acquisition/source."""
    h = header.lower()
    if any(k in h for k in ("source", "unlock", "acquisition", "obtained")):
        key = value.strip().upper()
        return ACQUISITION_MAP.get(key, value)
    return value


def parse_tables(html: str) -> List[Dict[str, str]]:
    soup = BeautifulSoup(html, "lxml")
    tables = soup.find_all("table")

    all_rows: List[Dict[str, str]] = []

    for table_idx, table in enumerate(tables):
        rows = table.find_all("tr")
        if not rows:
            continue

        headers = [clean_text(c.get_text()) for c in rows[0].find_all(["th", "td"])]

        # Identify index of "Lowest PI" safely
        drop_indices = {i for i, h in enumerate(headers) if h.lower() == "lowest pi"}

        filtered_headers = [h for i, h in enumerate(headers) if i not in drop_indices]

        if not any(filtered_headers):
            continue

        for tr in rows[1:]:
            cells = [clean_text(c.get_text()) for c in tr.find_all(["td", "th"])]
            if not cells:
                continue

            # Keep alignment by skipping only the exact column index
            filtered_cells = [
                cell for i, cell in enumerate(cells) if i not in drop_indices
            ]

            # Normalize row length
            if len(filtered_cells) < len(filtered_headers):
                filtered_cells += [""] * (len(filtered_headers) - len(filtered_cells))
            elif len(filtered_cells) > len(filtered_headers):
                filtered_cells = filtered_cells[: len(filtered_headers)]

            row_dict: Dict[str, str] = {}

            for header, value in zip(filtered_headers, filtered_cells):
                val = value

                if header.lower() in ("vehicle", "car"):
                    val = clean_vehicle_name(val)

                # Clean price-like values only if they contain CR
                if "cr" in value.lower():
                    val = parse_price(value)

                # Expand AC/BR/HA only in correct columns
                val = maybe_expand_acquisition(header, val)

                row_dict[header] = val

            row_dict["_table_index"] = str(table_idx)
            all_rows.append(row_dict)

    return all_rows


def write_csv(rows: List[Dict[str, str]], output_path: Path) -> None:
    if not rows:
        raise ValueError("No data extracted from HTML tables.")

    headers = sorted({k for r in rows for k in r.keys()})

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python extract_cars.py <input.html> <output.csv>")
        sys.exit(1)

    html_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    html = html_path.read_text(encoding="utf-8", errors="ignore")
    rows = parse_tables(html)
    write_csv(rows, out_path)

    print(f"[+] Extracted {len(rows)} rows -> {out_path}")


if __name__ == "__main__":
    main()
