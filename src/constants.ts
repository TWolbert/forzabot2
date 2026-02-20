export const CAR_CLASSES = ["D", "C", "B", "A", "S1", "S2"] as const;
export const RACE_TYPES = [
  "rally",
  "goliath",
  "circuit",
  "drag",
  "offroad",
  "all",
] as const;

export const CLASS_VALUE_RANGES: Record<(typeof CAR_CLASSES)[number], [number, number]> = {
  D: [50_000, 100_000],
  C: [75_000, 125_000],
  B: [100_000, 150_000],
  A: [125_000, 175_000],
  S1: [250_000, 350_000],
  S2: [350_000, 500_000],
};

export const CLASS_COLORS: Record<(typeof CAR_CLASSES)[number], number> = {
  D: 0x3dbaea,
  C: 0xf6bf31,
  B: 0xff6533,
  A: 0xfc355a,
  S1: 0xbd5ee4,
  S2: 0x1567d6,
};

export const USER_AGENT = "forzabot/1.0 (contact: discord bot)";
export const RACE_ICON_DIR = "media/races";
