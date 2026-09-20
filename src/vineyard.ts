// vineyard.ts — kad.dev's "Vineyard" palette, the fixed stage colour, and the
// deterministic per-commit provenance accent.
//
// The page-level accent is the STAGE colour: one fixed, accessible colour per
// stage of the three-commit tour (c1 blue, c2 green, c3 yellow). A later commit
// recolours the page by changing only the explicit `STAGE` value below — never
// the SHA. The SHA still derives the codename (identity.ts) and still tags every
// mark a commit writes through `commitAccent`, so seeded (migrated) data stays
// visibly distinct from native data.

export const INK = "#161512";
export const CREAM = "#fffef8";
export const CANVAS = "#f5f2e8";

export interface Accent {
  key: string;
  color: string; // the block colour
  on: string; // legible text colour on top of `color`
}

export type Stage = "c1" | "c2" | "c3";

export interface StageAccent extends Accent {
  stage: Stage;
}

// Fixed stage colours, reusing the Vineyard earth-tone values (steel / olive /
// gold). `on` is the legible foreground chosen for each block colour.
const STAGES: Record<Stage, StageAccent> = {
  c1: { stage: "c1", key: "blue", color: "#347a9e", on: CREAM },
  c2: { stage: "c2", key: "green", color: "#5a7d42", on: CREAM },
  c3: { stage: "c3", key: "yellow", color: "#caa435", on: INK },
};

// The one explicit value a later commit changes to select its stage colour.
export const STAGE: Stage = "c1";

export function stageAccent(stage: Stage = STAGE): StageAccent {
  return STAGES[stage];
}

const ACCENTS: readonly Accent[] = [
  { key: "terracotta", color: "#a84a35", on: CREAM },
  { key: "cognac", color: "#946a1a", on: CREAM },
  { key: "steel", color: "#347a9e", on: CREAM },
  { key: "olive", color: "#5a7d42", on: CREAM },
  { key: "gold", color: "#caa435", on: INK },
];

function firstByte(sha: string): number {
  const hex = sha.match(/[0-9a-f]/gi)?.join("") || sha;
  return parseInt(hex.slice(0, 2).padEnd(2, "0"), 16) || 0;
}

export function commitAccent(sha: string): Accent {
  return ACCENTS[firstByte(sha) % ACCENTS.length];
}
