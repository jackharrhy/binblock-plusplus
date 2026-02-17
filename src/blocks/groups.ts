export type BlockGroupConfig = Record<string, string[]>;

export const blockGroups: BlockGroupConfig = {
  blocks: [
    "00",
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
    "11",
    "12",
  ],
};

export function expandBlockGroup(blockIds: string[]): string[] {
  return blockIds;
}

export function getGroupedBlockIds(config: BlockGroupConfig): Set<string> {
  const grouped = new Set<string>();

  for (const blockIds of Object.values(config)) {
    for (const id of blockIds) {
      grouped.add(id);
    }
  }

  return grouped;
}
