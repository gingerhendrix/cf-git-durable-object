const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type PktLine =
  | { type: "data"; data: Uint8Array }
  | { type: "flush" }
  | { type: "delimiter" };

export function encodePktLine(payload: string | Uint8Array): Uint8Array {
  const data = typeof payload === "string" ? textEncoder.encode(payload) : payload;
  const length = data.length + 4;
  if (length > 0xffff) {
    throw new Error(`pkt-line too long: ${length}`);
  }
  const prefix = textEncoder.encode(length.toString(16).padStart(4, "0"));
  const out = new Uint8Array(prefix.length + data.length);
  out.set(prefix, 0);
  out.set(data, prefix.length);
  return out;
}

export function encodePktFlush(): Uint8Array {
  return textEncoder.encode("0000");
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function decodePktLineLength(prefix: Uint8Array): number {
  if (prefix.length !== 4) {
    throw new Error(`invalid pkt-line prefix length: ${prefix.length}`);
  }
  const str = textDecoder.decode(prefix);
  const length = Number.parseInt(str, 16);
  if (!Number.isFinite(length) || length < 0 || length > 0xffff) {
    throw new Error(`invalid pkt-line length: ${str}`);
  }
  return length;
}

export function* parsePktLines(
  input: Uint8Array,
  startOffset = 0,
): Generator<{ pkt: PktLine; offset: number; nextOffset: number }> {
  let offset = startOffset;
  while (offset + 4 <= input.length) {
    const length = decodePktLineLength(input.slice(offset, offset + 4));
    if (length === 0) {
      const nextOffset = offset + 4;
      yield { pkt: { type: "flush" }, offset, nextOffset };
      offset = nextOffset;
      continue;
    }
    if (length === 1) {
      const nextOffset = offset + 4;
      yield { pkt: { type: "delimiter" }, offset, nextOffset };
      offset = nextOffset;
      continue;
    }
    if (length < 4) {
      throw new Error(`invalid pkt-line length: ${length}`);
    }
    if (offset + length > input.length) {
      throw new Error(
        `truncated pkt-line: need ${length} bytes at ${offset}, have ${input.length - offset}`,
      );
    }
    const payload = input.slice(offset + 4, offset + length);
    const nextOffset = offset + length;
    yield { pkt: { type: "data", data: payload }, offset, nextOffset };
    offset = nextOffset;
  }
}

export function readPktLinesUntilFlush(
  input: Uint8Array,
  startOffset = 0,
): { lines: Uint8Array[]; offset: number } {
  const lines: Uint8Array[] = [];
  for (const { pkt, nextOffset } of parsePktLines(input, startOffset)) {
    if (pkt.type === "flush") {
      return { lines, offset: nextOffset };
    }
    if (pkt.type === "data") {
      lines.push(pkt.data);
    }
  }
  throw new Error("expected pkt-line flush");
}

export function decodePktText(line: Uint8Array): string {
  return textDecoder.decode(line);
}

