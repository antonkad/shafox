// vineyard.ts — kad.dev's "Vineyard" palette + a deterministic per-commit accent.
//
// Each commit picks one accent hue from the brand's earth-tone set (always the
// same hue for the same SHA). That hue recolours the page, so two concurrently
// deployed commits read as different — without primary-colour / black-grid
// cliché. The accent also tags every mark a commit writes, making seeded
// (migrated) data visibly distinct from native data.

export const INK = "#161512";
export const CREAM = "#fffef8";
export const CANVAS = "#f5f2e8";

export interface Accent {
  key: string;
  color: string; // the block colour
  on: string; // legible text colour on top of `color`
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
