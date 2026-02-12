export type BlockGroupConfig = Record<string, string[]>;

export const blockGroups: BlockGroupConfig = {
  colors: [
    "col7",
    "col_black_1",
    "col_black_2",
    "col_black_3",
    "col_black_4",
    "col_blue_hi",
    "col_blue_lo",
    "col_cyan_hi",
    "col_cyan_lo",
    "col_green_hi",
    "col_green_lo",
    "col_pink_hi",
    "col_pink_lo",
    "col_red_hi",
    "col_red_lo",
    "col_yellow_hi",
    "col_yellow_lo",
  ],
  gradients: [
    "col_blue_higrad02wht",
    "col_blue_higrad04wht",
    "col_blue_higrad10blk",
    "col_blue_higrad10blkrotCW",
    "col_blue_higrad10wht70",
    "col_blue_higrad10wht70rotCCW",
    "col_blue_higrad11wht60",
  ],
  corners: [
    "Corner_0164x64",
    "Corner_0264x64",
    "Corner_0364x64",
    "Corner_0464x64",
  ],
  horizontal: [
    "Horizontal_164x64",
    "Horizontal_164x64~1",
    "Horizontal_264x64",
    "Horizontal_Ripple_0264x64",
    "Horizontal_Ripple_0464x64",
    "Horizontal_Tile_0264x64",
    "Horizontal_Tile_0464x64",
    "Horizontal_Tile_0664x64",
  ],
  vertical: [
    "Vertical_164x64",
    "Vertical_264x64",
    "Vertical_Ripple_264x64",
    "Vertical_Ripple_464x64",
  ],
  ovals: ["Oval_164x64", "Oval_264x64", "Oval_364x64", "Oval_464x64"],
  circular: ["Circular_0764x64"],
  spokes: ["Spokes_0164x64", "Spokes_0764x64"],
  arrows: [
    "up",
    "up3",
    "up55",
    "upclose",
    "upsm",
    "upup",
    "down",
    "down2",
    "down22",
    "down44",
    "downrest",
    "downrest2",
    "left",
    "left22",
    "left67",
    "leftrest",
    "leftrest2",
    "right",
    "right32",
    "right76",
    "rightrest",
    "press",
    "press2",
  ],
  handrenders: [
    "handrender1",
    "handrender2",
    "handrender3",
    "handrender4",
    "handrender5",
    "handrender6",
    "handrender7",
    "handrender8",
    "handrender9",
    "handrender10",
    "handrender11",
  ],
  misc: [
    "ClaudiaSchiffer",
    "0041139956664",
    "1298000471",
    "68111",
    "6811111",
    "68111211",
    "6811164",
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
