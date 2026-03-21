export const SWING_CREDITS_BY_DIFFICULTY = Object.freeze({
  easy: 1,
  medium: 3,
  hard: 7
});

export function getSwingCreditsForDifficulty(difficulty) {
  const normalizedDifficulty = String(difficulty ?? "").toLowerCase();
  return SWING_CREDITS_BY_DIFFICULTY[normalizedDifficulty] ?? SWING_CREDITS_BY_DIFFICULTY.easy;
}

export function formatSwingCredits(credits) {
  return `${credits} swing credit${credits === 1 ? "" : "s"}`;
}
