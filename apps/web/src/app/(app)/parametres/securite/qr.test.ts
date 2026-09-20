import { describe, expect, it } from "vitest";
import {
  capacity,
  dataPositions,
  encode,
  errorCorrection,
  formatBits,
  functionLayout,
  type Matrix,
  toSvgPath,
  versionBits,
} from "./qr";

const EXP: number[] = [];
{
  let x = 1;
  for (let i = 0; i < 512; i += 1) {
    EXP.push(x);
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
}

function gfMul(a: number, b: number): number {
  let result = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if (y & 1) result ^= x;
    y >>= 1;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return result;
}

/** A Reed-Solomon codeword is divisible by the generator, so every syndrome is 0. */
function syndromes(codeword: number[], ecLength: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ecLength; i += 1) {
    let value = 0;
    for (const byte of codeword) value = gfMul(value, EXP[i] as number) ^ byte;
    out.push(value);
  }
  return out;
}

function maskAt(mask: number, row: number, column: number): boolean {
  const table: ((r: number, c: number) => boolean)[] = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  return (table[mask] as (r: number, c: number) => boolean)(row, column);
}

function readFormat(matrix: Matrix): { ecLevel: number; mask: number } {
  let bits = 0;
  for (let i = 0; i <= 7; i += 1) {
    if ((matrix.modules[matrix.size - 1 - i] as boolean[])[8]) bits |= 1 << i;
  }
  for (let i = 8; i <= 14; i += 1) {
    if ((matrix.modules[8] as boolean[])[matrix.size - 15 + i]) bits |= 1 << i;
  }
  const data = (bits ^ 0x5412) >> 10;
  return { ecLevel: data >> 3, mask: data & 7 };
}

/** Reads the stream back out of the drawn matrix, the other way round. */
function readCodewords(matrix: Matrix): number[] {
  const { reserved } = functionLayout(matrix.version);
  const positions = dataPositions(matrix.size, reserved);
  const bits: number[] = positions.map(([row, column]) => {
    const drawn = (matrix.modules[row] as boolean[])[column];
    const flipped = maskAt(matrix.mask, row, column) ? !drawn : drawn;
    return flipped ? 1 : 0;
  });
  const out: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] as number);
    out.push(byte);
  }
  return out;
}

/** Undoes the interleaving for the single-group versions used by the tests. */
function decode(matrix: Matrix, blocks: number, dataPerBlock: number): string {
  const stream = readCodewords(matrix);
  const groups: number[][] = Array.from({ length: blocks }, () => []);
  for (let i = 0; i < blocks * dataPerBlock; i += 1) {
    (groups[i % blocks] as number[]).push(stream[i] as number);
  }
  const data = groups.flat();
  const bits: number[] = [];
  for (const byte of data) {
    for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
  }
  const take = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i += 1) value = (value << 1) | (bits.shift() as number);
    return value;
  };
  expect(take(4)).toBe(0b0100);
  const length = take(matrix.version < 10 ? 8 : 16);
  const bytes: number[] = [];
  for (let i = 0; i < length; i += 1) bytes.push(take(8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

const TOTP_URI =
  "otpauth://totp/lfsci:proprietaire@exemple.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=lfsci&algorithm=SHA1&digits=6&period=30";

describe("qr", () => {
  it("picks the smallest version that fits", () => {
    expect(capacity(1)).toBe(17);
    expect(capacity(10)).toBe(271);
    expect(encode("a".repeat(17)).version).toBe(1);
    expect(encode("a".repeat(18)).version).toBe(2);
    expect(encode("a".repeat(271)).version).toBe(10);
    expect(() => encode("a".repeat(272))).toThrow(/version 10 capacity/);
  });

  it("draws the three finder patterns, the timing lines and the dark module", () => {
    const matrix = encode("HELLO");
    expect(matrix.size).toBe(21);
    const dark = (row: number, column: number) => (matrix.modules[row] as boolean[])[column];

    for (const [top, left] of [
      [0, 0],
      [0, 14],
      [14, 0],
    ] as [number, number][]) {
      expect(dark(top, left)).toBe(true);
      expect(dark(top + 1, left + 1)).toBe(false);
      expect(dark(top + 3, left + 3)).toBe(true);
    }
    expect(dark(7, 0)).toBe(false);
    for (let i = 8; i < 13; i += 1) expect(dark(6, i)).toBe(i % 2 === 0);
    expect(dark(matrix.size - 8, 8)).toBe(true);
  });

  it("writes a format string that decodes to level L and the chosen mask", () => {
    const matrix = encode(TOTP_URI);
    expect(readFormat(matrix)).toEqual({ ecLevel: 0b01, mask: matrix.mask });
    for (let mask = 0; mask < 8; mask += 1) {
      expect(formatBits(mask) >> 15).toBe(0);
    }
  });

  it("encodes the version information from version 7 on", () => {
    expect(versionBits(7)).toBe(0b000111110010010100);
    expect(versionBits(10)).toBe(0b001010010011010011);
  });

  it("produces Reed-Solomon codewords with zero syndromes", () => {
    const data = [...new TextEncoder().encode("facture 2026-09")];
    const ec = errorCorrection(data, 26);
    expect(ec).toHaveLength(26);
    expect(syndromes([...data, ...ec], 26)).toEqual(new Array(26).fill(0));
  });

  it("reads back what it drew, for a short text and for a TOTP URI", () => {
    expect(decode(encode("HELLO"), 1, 19)).toBe("HELLO");
    const matrix = encode(TOTP_URI);
    expect(matrix.version).toBe(6);
    expect(decode(matrix, 2, 68)).toBe(TOTP_URI);
  });

  it("survives accented bytes, which are two UTF-8 codewords each", () => {
    const text = "Bail échu — 12 rue de l’Église";
    expect(decode(encode(text), 1, 55)).toBe(text);
  });

  it("renders one square per dark module", () => {
    const matrix = encode("HELLO");
    const squares = toSvgPath(matrix).split("M").length - 1;
    expect(squares).toBe(matrix.modules.flat().filter(Boolean).length);
  });
});
