/**
 * Ad placements. For now every slot renders a placeholder box of the right
 * size. AdMob only serves native mobile apps; on the web the same Google
 * account uses AdSense: once it's approved, fill in `client` (ca-pub-…) and
 * each placement's `slot` ID, and AdSlot can render the real unit instead.
 */
export const ADS = {
  /** Premium users never see ads. */
  enabled: true,
  client: null as string | null,
  placements: {
    'stats-inline': { format: 'leaderboard', slot: null as string | null },
    'subjects-grid': { format: 'rectangle', slot: null as string | null },
  },
} as const;

export type AdPlacement = keyof typeof ADS.placements;
