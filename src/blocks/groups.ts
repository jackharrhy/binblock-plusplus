type BlockRange = [number, number];
type BlockSpecifier = number | BlockRange;

export type BlockGroupConfig = Record<string, BlockSpecifier[]>;

export const blockGroups: BlockGroupConfig = {
  a: [0],
  b: [[1, 7]],
  c: [[9, 16]],
  d: [[17, 24]],
  e: [[25, 32]],
  f: [[33, 40]],
  g: [[41, 48], 71],
  bricks: [[82, 91]],
  pipes: [[50, 53], [58, 61], 64],
  coin: [8, 49],
  bars: [72, 73],
  waves: [75, 76, 77, 74],
  person: [[54, 57]],
  face: [[92, 95]],
  rounded: [62, 66, 67, 68],
  curtain: [65, 69, 70],
  lights: [78, 81, 79, 80],
};

export function expandBlockGroup(specifiers: BlockSpecifier[]): string[] {
  const ids: string[] = [];

  for (const spec of specifiers) {
    if (Array.isArray(spec)) {
      const [start, end] = spec;
      for (let i = start; i <= end; i++) {
        ids.push(i.toString().padStart(2, "0"));
      }
    } else {
      ids.push(spec.toString().padStart(2, "0"));
    }
  }

  return ids;
}

export function getGroupedBlockIds(config: BlockGroupConfig): Set<string> {
  const grouped = new Set<string>();

  for (const specifiers of Object.values(config)) {
    for (const id of expandBlockGroup(specifiers)) {
      grouped.add(id);
    }
  }

  return grouped;
}
