import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { RACE_ICON_DIR, USER_AGENT } from "./constants";
import { db } from "./database";

export interface CarData {
  name: string;
  value: number;
}

let cachedCarNames: string[] | null = null;
let cachedCarData: CarData[] | null = null;
let raceIconMap: Record<string, string> | null = null;

// Utility functions
export const pickRandom = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)];

export const randomIntStep = (min: number, max: number, step: number): number => {
  const steps = Math.floor((max - min) / step);
  return min + step * Math.floor(Math.random() * (steps + 1));
};

export const formatCurrency = (value: number): string =>
  `$${value.toLocaleString("en-US")}`;

export const parseTime = (timeStr: string): number | null => {
  const match = timeStr.match(/^(\d+):(\d{1,2})\.(\d{1,3})$/);
  if (!match) return null;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  let milliseconds = parseInt(match[3], 10);

  // Pad milliseconds to 3 digits if necessary
  if (match[3].length === 1) {
    milliseconds *= 100;
  } else if (match[3].length === 2) {
    milliseconds *= 10;
  }

  if (seconds < 0 || seconds > 59) return null;
  if (milliseconds < 0 || milliseconds > 999) return null;

  return minutes * 60000 + seconds * 1000 + milliseconds;
};

export const normalizeSearchText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

export const parseCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
};

// Car loading and searching
export const loadCarData = async (): Promise<CarData[]> => {
  if (cachedCarData) return cachedCarData;

  const csv = await readFile("output.csv", "utf8");
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    cachedCarData = [];
    return cachedCarData;
  }

  const firstLine = lines[0];
  if (!firstLine) {
    cachedCarData = [];
    return cachedCarData;
  }

  const headers = parseCsvLine(firstLine);
  const vehicleIndex = headers.indexOf("Vehicle");
  const valueIndex = headers.indexOf("Value");

  if (vehicleIndex === -1 || valueIndex === -1) {
    cachedCarData = [];
    return cachedCarData;
  }

  const data = lines
    .slice(1)
    .map((line) => {
      const fields = parseCsvLine(line);
      const name = fields[vehicleIndex];
      const valueStr = fields[valueIndex];
      const value = valueStr ? parseInt(valueStr.replace(/[^0-9]/g, ""), 10) : 0;
      return { name, value };
    })
    .filter((entry): entry is CarData => Boolean(entry.name) && !isNaN(entry.value));

  cachedCarData = data;
  return data;
};

export const loadCarNames = async (): Promise<string[]> => {
  if (cachedCarNames) return cachedCarNames;

  const carData = await loadCarData();
  cachedCarNames = carData.map(car => car.name);
  return cachedCarNames;
};

export const fuzzyScore = (name: string, query: string): number => {
  if (!query) return 0;

  if (name.includes(query)) {
    return 1000 + Math.max(0, 50 - Math.abs(name.length - query.length));
  }

  const nameTokens = name.split(" ").filter(Boolean);
  const queryTokens = query.split(" ").filter(Boolean);
  const allTokensMatch = queryTokens.every((token) =>
    nameTokens.some((nameToken) =>
      nameToken.startsWith(token) || nameToken.includes(token)
    )
  );

  if (!allTokensMatch) return 0;

  const matchedPrefixes = queryTokens.filter((token) =>
    nameTokens.some((nameToken) => nameToken.startsWith(token))
  ).length;

  return 10 + matchedPrefixes + Math.max(0, 5 - Math.abs(nameTokens.length - queryTokens.length));
};

export const searchCars = async (rawQuery: string, maxValue?: number): Promise<string[]> => {
  const query = normalizeSearchText(rawQuery);
  if (!query) return [];

  const carData = await loadCarData();
  let filteredCars = carData;

  // Filter by max value if provided
  if (maxValue !== undefined) {
    filteredCars = carData.filter(car => car.value <= maxValue);
  }

  const scored = filteredCars
    .map((car) => {
      const normalized = normalizeSearchText(car.name);
      return {
        car: car.name,
        score: fuzzyScore(normalized, query),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((entry) => entry.car);

  return scored;
};

// API functions
export const fetchJson = async <T>(url: URL): Promise<T | null> => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(
      `Fandom API failed (${response.status}): ${errorText.slice(0, 300)}`
    );
    return null;
  }

  return (await response.json()) as T;
};

export const buildIconMap = async (dir: string): Promise<Record<string, string>> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const map: Record<string, string> = {};

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = path.parse(entry.name);
    if (!parsed.name) continue;
    map[parsed.name.toLowerCase()] = path.join(dir, entry.name);
  }

  return map;
};

export const getRaceIconPath = async (raceType: string): Promise<string | null> => {
  if (!raceIconMap) {
    raceIconMap = await buildIconMap(RACE_ICON_DIR);
  }

  return raceIconMap[raceType.toLowerCase()] ?? null;
};

export const getTopCarImage = async (carName: string): Promise<string | null> => {
  try {
    const confirmed = db.query("SELECT image_url FROM car_images WHERE lower(car_name) = lower(?)").get(carName) as { image_url?: string } | null;
    if (confirmed?.image_url) {
      return confirmed.image_url;
    }
  } catch (error) {
    console.warn(`Failed to read confirmed image for ${carName}:`, error);
  }
  const getFandomCarImage = async (): Promise<string | null> => {
    const baseUrl = "https://forza.fandom.com/api.php";

    const searchUrl = new URL(baseUrl);
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("list", "search");
    searchUrl.searchParams.set("srsearch", carName);
    searchUrl.searchParams.set("srlimit", "1");
    searchUrl.searchParams.set("format", "json");

    const searchData = await fetchJson<{
      query?: { search?: Array<{ title?: string }> };
    }>(searchUrl);

    const topTitle = searchData?.query?.search?.[0]?.title;
    if (!topTitle) return null;

    const imageUrl = new URL(baseUrl);
    imageUrl.searchParams.set("action", "query");
    imageUrl.searchParams.set("prop", "pageimages");
    imageUrl.searchParams.set("pithumbsize", "800");
    imageUrl.searchParams.set("titles", topTitle);
    imageUrl.searchParams.set("format", "json");

    const imageData = await fetchJson<{
      query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
    }>(imageUrl);

    const pages = imageData?.query?.pages ?? {};
    const firstPage = Object.values(pages)[0];
    return firstPage?.thumbnail?.source ?? null;
  };

  const getWikipediaCarImage = async (): Promise<string | null> => {
    const baseUrl = "https://en.wikipedia.org/w/api.php";

    const searchUrl = new URL(baseUrl);
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("list", "search");
    searchUrl.searchParams.set("srsearch", carName);
    searchUrl.searchParams.set("srlimit", "1");
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("origin", "*");

    const searchData = await fetchJson<{
      query?: { search?: Array<{ title?: string }> };
    }>(searchUrl);

    const topTitle = searchData?.query?.search?.[0]?.title;
    if (!topTitle) return null;

    const imageUrl = new URL(baseUrl);
    imageUrl.searchParams.set("action", "query");
    imageUrl.searchParams.set("prop", "pageimages");
    imageUrl.searchParams.set("pithumbsize", "800");
    imageUrl.searchParams.set("titles", topTitle);
    imageUrl.searchParams.set("format", "json");
    imageUrl.searchParams.set("origin", "*");

    const imageData = await fetchJson<{
      query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
    }>(imageUrl);

    const pages = imageData?.query?.pages ?? {};
    const firstPage = Object.values(pages)[0];
    return firstPage?.thumbnail?.source ?? null;
  };

  const fandomImage = await getFandomCarImage();
  if (fandomImage) return fandomImage;
  return getWikipediaCarImage();
};
