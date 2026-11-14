declare const __MATHSLOT_INLINE_WASM_B64__: string | undefined;

export function decodeEmbeddedWasmBytes(): Uint8Array {
  const b64 = typeof __MATHSLOT_INLINE_WASM_B64__ === 'string' ? __MATHSLOT_INLINE_WASM_B64__ : '';
  if (!b64) {
    throw new Error(
      'Embedded MathSlot WASM payload is missing. Run obsidian-mathslot/scripts/build.mjs or pass wasmBytes explicitly.',
    );
  }

  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  const nodeBuffer = (
    globalThis as unknown as {
      Buffer?: { from(input: string, encoding: string): ArrayLike<number> };
    }
  ).Buffer;
  if (nodeBuffer) {
    return Uint8Array.from(nodeBuffer.from(b64, 'base64'));
  }

  throw new Error('Base64 decoder unavailable in current runtime.');
}
