/**
 * Minimal QR encoder: byte mode, error correction level L, versions 1 to 10
 * (271 characters, well above an `otpauth://` URI). No package in the tree
 * draws one, and the alternative — sending the TOTP secret to a third-party
 * image service — is not one.
 *
 * ISO/IEC 18004. `qr.test.ts` decodes what this produces and checks the
 * Reed-Solomon syndromes, so the two directions are written independently.
 */

type Block = { count: number; dataCodewords: number };
type VersionSpec = { totalCodewords: number; ecPerBlock: number; blocks: Block[] };

/** Level L only. dataCodewords × blocks + ecPerBlock × blocks = totalCodewords. */
const VERSIONS: VersionSpec[] = [
  { totalCodewords: 26, ecPerBlock: 7, blocks: [{ count: 1, dataCodewords: 19 }] },
  { totalCodewords: 44, ecPerBlock: 10, blocks: [{ count: 1, dataCodewords: 34 }] },
  { totalCodewords: 70, ecPerBlock: 15, blocks: [{ count: 1, dataCodewords: 55 }] },
  { totalCodewords: 100, ecPerBlock: 20, blocks: [{ count: 1, dataCodewords: 80 }] },
  { totalCodewords: 134, ecPerBlock: 26, blocks: [{ count: 1, dataCodewords: 108 }] },
  { totalCodewords: 172, ecPerBlock: 18, blocks: [{ count: 2, dataCodewords: 68 }] },
  { totalCodewords: 196, ecPerBlock: 20, blocks: [{ count: 2, dataCodewords: 78 }] },
  { totalCodewords: 242, ecPerBlock: 24, blocks: [{ count: 2, dataCodewords: 97 }] },
  { totalCodewords: 292, ecPerBlock: 30, blocks: [{ count: 2, dataCodewords: 116 }] },
  {
    totalCodewords: 346,
    ecPerBlock: 18,
    blocks: [
      { count: 2, dataCodewords: 68 },
      { count: 2, dataCodewords: 69 },
    ],
  },
];

const ALIGNMENT_CENTERS: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] as number;
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] as number) + (LOG[b] as number)] as number;
}

function generatorPolynomial(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] as number) ^ mul(poly[j] as number, EXP[i] as number);
      next[j + 1] = (next[j + 1] as number) ^ (poly[j] as number);
    }
    poly = next;
  }
  // Built constant-first; the division below indexes it leading-coefficient-first.
  return poly.reverse();
}

export function errorCorrection(data: number[], ecLength: number): number[] {
  const generator = generatorPolynomial(ecLength);
  const remainder = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] as number);
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLength; i += 1) {
        remainder[i] = (remainder[i] as number) ^ mul(generator[i + 1] as number, factor);
      }
    }
  }
  return remainder;
}

/** BCH(15,5) with generator 0x537, masked by 0x5412 (level L is 0b01). */
export function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask;
  let value = data << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if ((value >> bit) & 1) value ^= 0x537 << (bit - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

/** BCH(18,6) with generator 0x1f25, unmasked. Versions 7 and above only. */
export function versionBits(version: number): number {
  let value = version << 12;
  for (let bit = 17; bit >= 12; bit -= 1) {
    if ((value >> bit) & 1) value ^= 0x1f25 << (bit - 12);
  }
  return (version << 12) | value;
}

export function capacity(version: number): number {
  const spec = VERSIONS[version - 1] as VersionSpec;
  const dataCodewords = spec.blocks.reduce(
    (total, block) => total + block.count * block.dataCodewords,
    0,
  );
  return dataCodewords - (version < 10 ? 2 : 3);
}

function chooseVersion(length: number): number {
  for (let version = 1; version <= VERSIONS.length; version += 1) {
    if (length <= capacity(version)) return version;
  }
  throw new Error(`text of ${length} bytes exceeds the version 10 capacity`);
}

class Bits {
  readonly values: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.values.push((value >> i) & 1);
  }
}

function codewords(text: string, version: number): number[] {
  const spec = VERSIONS[version - 1] as VersionSpec;
  const bytes = [...new TextEncoder().encode(text)];
  const dataCodewords = spec.blocks.reduce(
    (total, block) => total + block.count * block.dataCodewords,
    0,
  );

  const bits = new Bits();
  bits.push(0b0100, 4);
  bits.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) bits.push(byte, 8);
  bits.push(0, Math.min(4, dataCodewords * 8 - bits.values.length));
  while (bits.values.length % 8 !== 0) bits.values.push(0);

  const out: number[] = [];
  for (let i = 0; i < bits.values.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits.values[i + j] as number);
    out.push(byte);
  }
  for (let i = 0; out.length < dataCodewords; i += 1) out.push(i % 2 === 0 ? 0xec : 0x11);
  return out;
}

export function interleave(text: string, version: number): number[] {
  const spec = VERSIONS[version - 1] as VersionSpec;
  const source = codewords(text, version);

  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const block of spec.blocks) {
    for (let i = 0; i < block.count; i += 1) {
      const chunk = source.slice(offset, offset + block.dataCodewords);
      offset += block.dataCodewords;
      dataBlocks.push(chunk);
      ecBlocks.push(errorCorrection(chunk, spec.ecPerBlock));
    }
  }

  const result: number[] = [];
  const longest = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i] as number);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) result.push(block[i] as number);
  }
  return result;
}

export type Matrix = { size: number; modules: boolean[][]; version: number; mask: number };

function emptyMatrix(size: number): { modules: boolean[][]; reserved: boolean[][] } {
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { modules, reserved };
}

function drawFunctionPatterns(modules: boolean[][], reserved: boolean[][], version: number): void {
  const size = modules.length;
  const set = (row: number, column: number, dark: boolean): void => {
    (modules[row] as boolean[])[column] = dark;
    (reserved[row] as boolean[])[column] = true;
  };

  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as [number, number][]) {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const r = top + row;
        const c = left + column;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const onRing = row === 0 || row === 6 || column === 0 || column === 6;
        const inCore = row >= 2 && row <= 4 && column >= 2 && column <= 4;
        const inside = row >= 0 && row <= 6 && column >= 0 && column <= 6;
        set(r, c, inside && (onRing || inCore));
      }
    }
  }

  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  for (const row of ALIGNMENT_CENTERS[version - 1] as number[]) {
    for (const column of ALIGNMENT_CENTERS[version - 1] as number[]) {
      if ((reserved[row] as boolean[])[column]) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          set(row + dr, column + dc, ring !== 1);
        }
      }
    }
  }

  // The dark module and the two format strips are reserved before any data.
  set(size - 8, 8, true);
  for (let i = 0; i < 9; i += 1) {
    if (!(reserved[8] as boolean[])[i]) set(8, i, false);
    if (!(reserved[i] as boolean[])[8]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!(reserved[8] as boolean[])[size - 1 - i]) set(8, size - 1 - i, false);
    if (!(reserved[size - 1 - i] as boolean[])[8]) set(size - 1 - i, 8, false);
  }

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >> i) & 1) === 1;
      const row = Math.floor(i / 3);
      const column = size - 11 + (i % 3);
      set(row, column, dark);
      set(column, row, dark);
    }
  }
}

/** Two columns at a time, right to left, skipping the vertical timing column. */
export function dataPositions(size: number, reserved: boolean[][]): [number, number][] {
  const positions: [number, number][] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    const pair = right === 6 ? 5 : right;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const column of [pair, pair - 1]) {
        if (!(reserved[row] as boolean[])[column]) positions.push([row, column]);
      }
    }
    upward = !upward;
  }
  return positions;
}

function maskAt(mask: number, row: number, column: number): boolean {
  switch (mask) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
  }
}

function writeFormat(modules: boolean[][], mask: number): void {
  const size = modules.length;
  const bits = formatBits(mask);
  const dark = (index: number): boolean => ((bits >> index) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) (modules[8] as boolean[])[i] = dark(i);
  (modules[8] as boolean[])[7] = dark(6);
  (modules[8] as boolean[])[8] = dark(7);
  (modules[7] as boolean[])[8] = dark(8);
  for (let i = 9; i <= 14; i += 1) (modules[14 - i] as boolean[])[8] = dark(i);

  for (let i = 0; i <= 7; i += 1) (modules[size - 1 - i] as boolean[])[8] = dark(i);
  for (let i = 8; i <= 14; i += 1) (modules[8] as boolean[])[size - 15 + i] = dark(i);
}

const FINDER_RUN = [true, false, true, true, true, false, true];

function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i += 1) {
    lines.push(modules[i] as boolean[]);
    lines.push(modules.map((row) => (row as boolean[])[i] as boolean));
  }

  for (const line of lines) {
    let run = 1;
    for (let i = 1; i < size; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
        continue;
      }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
    if (run >= 5) score += 3 + (run - 5);

    for (let i = 0; i + 6 < size; i += 1) {
      const window = line.slice(i, i + 7);
      if (!FINDER_RUN.every((value, index) => window[index] === value)) continue;
      const before = line.slice(Math.max(0, i - 4), i);
      const after = line.slice(i + 7, i + 11);
      if (before.length === 4 && before.every((value) => !value)) score += 40;
      if (after.length === 4 && after.every((value) => !value)) score += 40;
    }
  }

  for (let row = 0; row + 1 < size; row += 1) {
    for (let column = 0; column + 1 < size; column += 1) {
      const corner = (modules[row] as boolean[])[column];
      if (
        corner === (modules[row] as boolean[])[column + 1] &&
        corner === (modules[row + 1] as boolean[])[column] &&
        corner === (modules[row + 1] as boolean[])[column + 1]
      ) {
        score += 3;
      }
    }
  }

  const dark = modules.flat().filter(Boolean).length;
  const deviation = Math.abs((dark * 100) / (size * size) - 50);
  return score + Math.floor(deviation / 5) * 10;
}

export function functionLayout(version: number): {
  modules: boolean[][];
  reserved: boolean[][];
} {
  const layout = emptyMatrix(17 + 4 * version);
  drawFunctionPatterns(layout.modules, layout.reserved, version);
  return layout;
}

export function encode(text: string): Matrix {
  const version = chooseVersion(new TextEncoder().encode(text).length);
  const size = 17 + 4 * version;
  const { modules: base, reserved } = functionLayout(version);

  const stream = interleave(text, version);
  const positions = dataPositions(size, reserved);
  positions.forEach(([row, column], index) => {
    const byte = stream[index >> 3];
    // The last few positions of some versions are remainder bits, always 0.
    const bit = byte === undefined ? 0 : (byte >> (7 - (index & 7))) & 1;
    (base[row] as boolean[])[column] = bit === 1;
  });

  let best: Matrix | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const modules = base.map((row) => [...row]);
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        if ((reserved[row] as boolean[])[column]) continue;
        if (maskAt(mask, row, column)) {
          (modules[row] as boolean[])[column] = !(modules[row] as boolean[])[column];
        }
      }
    }
    writeFormat(modules, mask);
    const score = penalty(modules);
    if (score < bestScore) {
      bestScore = score;
      best = { size, modules, version, mask };
    }
  }
  return best as Matrix;
}

/** One `<path>` of module squares, sized in module units by the viewBox. */
export function toSvgPath(matrix: Matrix): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if ((matrix.modules[row] as boolean[])[column]) parts.push(`M${column} ${row}h1v1h-1z`);
    }
  }
  return parts.join("");
}

export const QUIET_ZONE = 4;
