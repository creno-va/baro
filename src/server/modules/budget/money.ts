import { decimalSchema } from "./contracts";

type Fraction = { numerator: bigint; denominator: bigint };
export function decimal(value: string): Fraction {
  const checked = decimalSchema.parse(value);
  const [integer, fraction = ""] = checked.split(".");
  return {
    numerator: BigInt(`${integer}${fraction}`),
    denominator: 10n ** BigInt(fraction.length),
  };
}
export function add(a: Fraction, b: Fraction): Fraction {
  return {
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  };
}
export function multiply(a: Fraction, b: Fraction): Fraction {
  return { numerator: a.numerator * b.numerator, denominator: a.denominator * b.denominator };
}
export function divide(a: Fraction, b: Fraction): Fraction {
  if (b.numerator <= 0n) throw new Error("Invalid cost denominator");
  return { numerator: a.numerator * b.denominator, denominator: a.denominator * b.numerator };
}
export function ceiling(value: Fraction): bigint {
  return (value.numerator + value.denominator - 1n) / value.denominator;
}
export function billableQuantity(quantity: string, quantum: string): Fraction {
  const step = decimal(quantum);
  return multiply({ numerator: ceiling(divide(decimal(quantity), step)), denominator: 1n }, step);
}
export function krwCeiling(usd: Fraction, fx: string, ratios: readonly string[]): number {
  let cost = multiply(usd, decimal(fx));
  for (const ratio of ratios) cost = multiply(cost, add(decimal("1"), decimal(ratio)));
  const amount = ceiling(cost);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Cost exceeds safe integer range");
  return Number(amount);
}
