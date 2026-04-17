#!/usr/bin/env python3
"""Fetch FH5 car data from a Google Sheet and export autoshow cars to CSV."""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path
from typing import Dict, List
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

DEFAULT_SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "1yucDOQ2nRaCcC4y4unl72Um7N_pQXuaI6gZqzf0Tl3M/edit?gid=286219065#gid=286219065"
)

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

OUTPUT_COLUMNS = ["Vehicle", "Value", "PI", "Availability"]


def clean_text(text: str) -> str:
    return " ".join((text or "").replace("\xa0", " ").split()).strip()


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


def normalize_vehicle_for_bot(vehicle: str, year_value: str) -> str:
    """Convert '2017 Acura NSX' -> 'Acura NSX 2017' to match existing bot data format."""
    text = clean_vehicle_name(vehicle)
    if not text:
        return text

    match = re.match(r"^(\d{4})\s+(.+)$", text)
    if not match:
        return text

    year_from_name, rest = match.groups()
    year_clean = clean_text(year_value)
    year = year_clean if year_clean.isdigit() and len(year_clean) == 4 else year_from_name
    return f"{rest} {year}".strip()


def maybe_expand_acquisition(header: str, value: str) -> str:
    """Only expand AC/BR/HA if column name implies acquisition/source."""
    h = header.lower()
    if any(k in h for k in ("source", "unlock", "acquisition", "obtained")):
        key = value.strip().upper()
        return ACQUISITION_MAP.get(key, value)
    return value


def has_autoshow_availability(availability: str) -> bool:
    return "autoshow" in availability.lower()


def sanitize_headers(headers: List[str]) -> List[str]:
    cleaned: List[str] = []
    seen: Dict[str, int] = {}

    for idx, raw in enumerate(headers):
        base = clean_text(raw) or f"column_{idx + 1}"
        count = seen.get(base, 0) + 1
        seen[base] = count
        cleaned.append(base if count == 1 else f"{base}_{count}")

    return cleaned


def extract_sheet_id_and_gid(sheet_url: str) -> tuple[str, str]:
    parsed = urlparse(sheet_url)
    parts = [p for p in parsed.path.split("/") if p]

    if "spreadsheets" not in parts or "d" not in parts:
        raise ValueError("Expected a Google Sheets URL (docs.google.com/spreadsheets/d/<id>/...)" )

    d_idx = parts.index("d")
    if d_idx + 1 >= len(parts):
        raise ValueError("Could not extract spreadsheet ID from URL")

    sheet_id = parts[d_idx + 1]
    query = parse_qs(parsed.query)
    gid = query.get("gid", [""])[0]

    if not gid and parsed.fragment.startswith("gid="):
        gid = parsed.fragment.split("=", 1)[1]

    return sheet_id, gid or "0"


def to_export_csv_url(sheet_url: str) -> str:
    sheet_id, gid = extract_sheet_id_and_gid(sheet_url)
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"


def download_csv(sheet_url: str) -> str:
    export_url = to_export_csv_url(sheet_url)
    request = Request(
        export_url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; forzabot2 scraper/1.0)"},
    )

    with urlopen(request) as response:
        data = response.read()

    return data.decode("utf-8-sig", errors="ignore")


def parse_google_sheet_rows(csv_text: str) -> List[Dict[str, str]]:
    reader = csv.reader(csv_text.splitlines())
    rows = list(reader)
    if not rows:
        return []

    headers = sanitize_headers(rows[0])
    all_rows: List[Dict[str, str]] = []

    for raw_row in rows[1:]:
        if not any(clean_text(v) for v in raw_row):
            continue

        if len(raw_row) < len(headers):
            raw_row += [""] * (len(headers) - len(raw_row))
        elif len(raw_row) > len(headers):
            raw_row = raw_row[: len(headers)]

        row = {
            header: maybe_expand_acquisition(header, clean_text(value))
            for header, value in zip(headers, raw_row)
        }

        vehicle_raw = row.get("Year Makes: 134 Models: 902") or row.get("Vehicle") or row.get("Car") or ""
        vehicle = normalize_vehicle_for_bot(vehicle_raw, row.get("Year", ""))
        if not vehicle:
            continue

        raw_price = row.get("Car Value") or row.get("Value") or ""
        value = parse_price(raw_price)

        availability_parts: List[str] = []
        for key in ("Special Access", "Special Reward/Gift", "Direct Access"):
            part = clean_text(row.get(key, ""))
            if part:
                availability_parts.append(part.lower())
        availability = " / ".join(availability_parts)

        if not has_autoshow_availability(availability):
            continue

        pi = clean_text(row.get("PI", ""))

        all_rows.append(
            {
                "Vehicle": vehicle,
                "Value": value,
                "PI": pi,
                "Availability": availability,
            }
        )

    return all_rows


def write_csv(rows: List[Dict[str, str]], output_path: Path) -> None:
    if not rows:
        raise ValueError("No autoshow cars found in Google Sheet data.")

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    if len(sys.argv) < 2:
        print(
            "Usage: python scraper.py <output.csv> [google_sheet_url]\n"
            f"Default URL: {DEFAULT_SHEET_URL}"
        )
        sys.exit(1)

    out_path = Path(sys.argv[1])
    sheet_url = sys.argv[2] if len(sys.argv) >= 3 else DEFAULT_SHEET_URL

    csv_text = download_csv(sheet_url)
    rows = parse_google_sheet_rows(csv_text)
    write_csv(rows, out_path)

    print(f"[+] Extracted {len(rows)} autoshow rows -> {out_path}")


if __name__ == "__main__":
    main()
