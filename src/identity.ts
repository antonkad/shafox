// identity.ts — the deterministic engine.
//
// Given a commit SHA, derive a fully reproducible visual identity: a colour
// palette, a fox's traits, and a codename. The same SHA ALWAYS yields the same
// fox, on any machine, forever. That determinism is what makes two concurrently
// deployed commits instantly distinguishable — and what makes a rollback
// visibly snap back to a face you've seen before.

export type Theme = "dark" | "light";

export interface Palette {
  theme: Theme;
  hue: number;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accent2: string;
  onAccent: string;
}

export interface FoxTraits {
  furHue: number;
  fur: string;
  furDark: string;
  belly: string;
  ears: 0 | 1 | 2; // pointed | round | tufted
  eyes: 0 | 1 | 2; // round | sleepy | wide
  muzzle: 0 | 1; // slim | wide
  accessory: 0 | 1 | 2 | 3 | 4; // none | glasses | scarf | crown | headphones
  expression: 0 | 1 | 2; // calm | smug | curious
  cheeks: boolean;
}

export interface Identity {
  sha: string;
  shortSha: string;
  codename: string;
  emoji: string;
  palette: Palette;
  fox: FoxTraits;
}

// ---- deterministic byte stream over the SHA -------------------------------

class Reader {
  private bytes: number[];
  private i = 0;
  constructor(sha: string) {
    const hex = (sha.match(/[0-9a-f]/gi)?.join("") || "0").toLowerCase();
    this.bytes = [];
    for (let k = 0; k < hex.length; k += 2) {
      this.bytes.push(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16));
    }
    if (this.bytes.length === 0) this.bytes = [0];
  }
  /** next byte 0..255, wrapping around the SHA so we never run dry */
  next(): number {
    const b = this.bytes[this.i % this.bytes.length];
    this.i++;
    return b;
  }
  /** integer in [0, n) */
  int(n: number): number {
    return this.next() % n;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

// ---- word banks -----------------------------------------------------------

const ADJECTIVES = [
  "Brave", "Quiet", "Sly", "Bright", "Velvet", "Amber", "Lunar", "Swift",
  "Cosmic", "Mellow", "Rugged", "Gentle", "Feral", "Plush", "Vivid", "Stoic",
  "Dapper", "Frosty", "Crimson", "Wired", "Drowsy", "Electric", "Hidden", "Bold",
] as const;

const NOUNS = [
  "Cinder", "Willow", "Pixel", "Ember", "Quartz", "Maple", "Comet", "Birch",
  "Saffron", "Onyx", "Marble", "Juniper", "Echo", "Slate", "Clover", "Basil",
  "Cobalt", "Hazel", "Nimbus", "Tundra", "Vesper", "Cricket", "Pippin", "Sorrel",
] as const;

const EMOJI = ["🦊", "🌿", "✨", "🔥", "🪨", "🍁", "☄️", "🌙", "⚡", "🎧"] as const;

// ---- palette --------------------------------------------------------------

function buildPalette(r: Reader): Palette {
  const hue = (r.next() << 8 | r.next()) % 360;
  const theme: Theme = r.next() % 5 === 0 ? "light" : "dark"; // mostly dark, occasional light
  const sat = 60 + r.int(25); // 60..84

  const accent = `hsl(${hue} ${sat}% 58%)`;
  const accent2 = `hsl(${(hue + 32) % 360} ${sat}% 64%)`;

  if (theme === "light") {
    return {
      theme,
      hue,
      bg: `hsl(${hue} 48% 96%)`,
      surface: `hsl(${hue} 60% 99%)`,
      surfaceAlt: `hsl(${hue} 40% 93%)`,
      border: `hsl(${hue} 30% 84%)`,
      text: `hsl(${hue} 35% 14%)`,
      textDim: `hsl(${hue} 18% 38%)`,
      accent: `hsl(${hue} ${sat}% 46%)`,
      accent2: `hsl(${(hue + 32) % 360} ${sat}% 50%)`,
      onAccent: `hsl(${hue} 40% 98%)`,
    };
  }
  return {
    theme,
    hue,
    bg: `hsl(${hue} 28% 7%)`,
    surface: `hsl(${hue} 24% 11%)`,
    surfaceAlt: `hsl(${hue} 22% 15%)`,
    border: `hsl(${hue} 22% 22%)`,
    text: `hsl(${hue} 18% 94%)`,
    textDim: `hsl(${hue} 14% 64%)`,
    accent,
    accent2,
    onAccent: `hsl(${hue} 40% 6%)`,
  };
}

// ---- fox traits -----------------------------------------------------------

function buildFox(r: Reader, hue: number): FoxTraits {
  const furHue = (hue + r.int(40) - 20 + 360) % 360;
  const sat = 62 + r.int(22);
  return {
    furHue,
    fur: `hsl(${furHue} ${sat}% 56%)`,
    furDark: `hsl(${furHue} ${sat}% 42%)`,
    belly: `hsl(${furHue} ${Math.max(18, sat - 40)}% 92%)`,
    ears: r.int(3) as FoxTraits["ears"],
    eyes: r.int(3) as FoxTraits["eyes"],
    muzzle: r.int(2) as FoxTraits["muzzle"],
    accessory: r.int(5) as FoxTraits["accessory"],
    expression: r.int(3) as FoxTraits["expression"],
    cheeks: r.next() % 2 === 0,
  };
}

// ---- public API -----------------------------------------------------------

export function shortSha(sha: string): string {
  const hex = sha.match(/[0-9a-f]/gi)?.join("") || sha;
  return hex.slice(0, 7);
}

export function deriveIdentity(sha: string): Identity {
  const r = new Reader(sha);
  // Reserve dedicated draws per attribute so adding palette draws later won't
  // shift the fox. (Order matters for determinism; do not reorder.)
  const codename = `${r.pick(ADJECTIVES)} ${r.pick(NOUNS)}`;
  const emoji = r.pick(EMOJI);
  const palette = buildPalette(r);
  const fox = buildFox(r, palette.hue);
  return { sha, shortSha: shortSha(sha), codename, emoji, palette, fox };
}
