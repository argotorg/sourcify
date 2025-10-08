export function bytesFromString(str: string): Buffer;
export function bytesFromString(str: string | undefined): Buffer | undefined;

export function bytesFromString(str: string | undefined): Buffer | undefined {
  if (str === undefined) {
    return undefined;
  }

  const normalized = str.startsWith("0x") ? str.slice(2) : str;
  return Buffer.from(normalized, "hex");
}
