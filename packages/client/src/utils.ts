const MAX_DELAY_MS = 30000;
const JITTER_MIN_MS = 300;
const JITTER_MAX_MS = 3000;

export function exponentialBackoff(retries: number): Promise<void> {
  const delay =
    Math.min(Math.pow(2, retries) * 1000, MAX_DELAY_MS) +
    Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS) + JITTER_MIN_MS);

  return new Promise((resolve) => setTimeout(resolve, delay));
}
