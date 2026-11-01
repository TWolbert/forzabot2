export const CAR_CLASSES = ["D", "C", "B", "A", "S1", "S2", "R", "X"] as const;
export const RACE_TYPES = [
  "road",
  "dirt",
  "cross-country",
  "street",
  "touge",
  "time-attack",
  "goliath",
  "drag",
  "candr",
  "all",
] as const;

export const CANDR_PRESET_CARS = [
  "Nissan Silvia K's 1989",
  "Toyota Celica GT-Four ST205 1994",
  "GMC Jimmy 1970",
] as const;

export const CLASS_VALUE_RANGES: Record<(typeof CAR_CLASSES)[number], [number, number]> = {
  D: [50_000, 100_000],
  C: [50_000, 200_000],
  B: [50_000, 300_000],
  A: [50_000, 400_000],
  S1: [100_000, 500_000],
  S2: [250_000, 500_000],
  R: [400_000, 500_000],
  X: [450_000, 500_000],
};

export const CLASS_COLORS: Record<(typeof CAR_CLASSES)[number], number> = {
  D: 0x3dbaea,
  C: 0xf6bf31,
  B: 0xff6533,
  A: 0xfc355a,
  S1: 0xbd5ee4,
  S2: 0x1567d6,
  R: 0x14b8a6,
  X: 0x111827,
};

export const USER_AGENT = "forzabot/1.0 (contact: discord bot)";
export const RACE_ICON_DIR = "media/races";
