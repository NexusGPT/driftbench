let earlier: { rows: number[][]; tail: number[]; text: string } | undefined;

export function fresh() {
  const rows = Array.from({ length: 80 }, (_, row) =>
    Array.from({ length: 129 }, (_, col) => row * 1000 + col),
  );
  return { rows, tail: [-0, Number.NaN, Number.POSITIVE_INFINITY], text: 't:h:'.repeat(20_000) };
}

export function keep() {
  earlier = fresh();
  return earlier;
}

export function change(where: string) {
  if (!earlier) throw new Error('call keep first');
  if (where === 'row') (earlier.rows[40] as number[])[128] = -1;
  else if (where === 'zero') earlier.tail[0] = 0;
  else if (where === 'text') earlier.text = 'short';
  else Object.defineProperty(earlier.tail, 'hidden', { value: 1 });
  return true;
}

export function read(value: unknown) {
  return value;
}
