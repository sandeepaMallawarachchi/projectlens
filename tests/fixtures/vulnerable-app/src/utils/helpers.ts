// @ts-ignore
import legacy from './legacy';

export function parse(input: any): any {
  return JSON.parse(input as any);
}

export function classify(a: number, b: number, c: number, d: number, e: number, f: number): string {
  if (a > 0) {
    if (b > 0) {
      if (c > 0) {
        if (d > 0) {
          if (e > 0) {
            return f > 0 ? 'all' : 'most';
          }
        }
      }
    }
  }
  if (a === 1 || b === 1 || c === 1 || d === 1 || e === 1 || f === 1) {
    return a && b ? 'one' : c || d ? 'two' : e ?? f ? 'three' : 'four';
  }
  switch (a) {
    case 2:
      return 'two';
    case 3:
      return 'three';
    case 4:
      return 'four';
    default:
      return legacy(a) as unknown as string;
  }
}

export function loadAll(urls: string[]) {
  urls.forEach((u) => {
    fetch(u).then((r) => r.json());
  });
}
// FIXME: remove legacy helpers before launch
