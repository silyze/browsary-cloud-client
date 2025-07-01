const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = BigInt(62);

export function encodeUuidToBase62(uuid: string): string {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) throw new Error("Invalid UUID format");

  let num = BigInt("0x" + hex);
  let result = "";

  while (num > 0n) {
    const remainder = num % BASE;
    result = BASE62_ALPHABET[Number(remainder)] + result;
    num /= BASE;
  }

  return result || "0";
}

export function decodeBase62ToUuid(base62: string): string {
  let num = 0n;

  for (const char of base62) {
    const index = BASE62_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base62 character: ${char}`);
    num = num * BASE + BigInt(index);
  }

  let hex = num.toString(16);
  hex = hex.padStart(32, "0");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
