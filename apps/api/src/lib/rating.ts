export type RatingResult = {
  userId: string;
  before: number;
  after: number;
  delta: number;
};

function expectedScore(playerRating: number, opponentAvg: number): number {
  return 1 / (1 + 10 ** ((opponentAvg - playerRating) / 400));
}

function actualScore(rank: number, totalPlayers: number): number {
  if (totalPlayers <= 1) {
    return 0.5;
  }

  return (totalPlayers - rank) / (totalPlayers - 1);
}

export function calculateMultiPlayerElo(
  standings: Array<{ userId: string; rank: number; rating: number }>,
  kFactor = 32,
): RatingResult[] {
  if (standings.length === 0) {
    return [];
  }

  return standings.map((entry) => {
    const opponents = standings.filter((s) => s.userId !== entry.userId);
    const opponentAvg =
      opponents.length > 0
        ? opponents.reduce((acc, curr) => acc + curr.rating, 0) / opponents.length
        : entry.rating;

    const expected = expectedScore(entry.rating, opponentAvg);
    const actual = actualScore(entry.rank, standings.length);
    const delta = Math.round(kFactor * (actual - expected));
    const after = Math.max(100, entry.rating + delta);

    return {
      userId: entry.userId,
      before: entry.rating,
      after,
      delta: after - entry.rating,
    };
  });
}
