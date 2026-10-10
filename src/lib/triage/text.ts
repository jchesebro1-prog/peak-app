/** Word-level normalization shared by the transcript match and the duplicate collapse. Pure, client-safe. */

export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "to", "of", "for", "on", "in", "at", "by", "with", "from",
  "is", "are", "was", "be", "been", "it", "its", "this", "that", "these", "those",
  "i", "we", "you", "he", "she", "they", "me", "us", "him", "her", "them", "my", "our", "your", "their",
  "will", "would", "should", "can", "could", "need", "needs", "please", "just", "so", "up", "out", "about",
  "do", "get", "go", "let", "lets", "ok", "okay", "yeah",
]);

/** Lowercased word tokens, apostrophes dropped ("I'll" → "ill"), punctuation split, stopwords removed. */
export function tokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "" && !STOPWORDS.has(w));
}

/** Order-independent comparable form of a title: unique tokens, sorted. "" when nothing meaningful is left. */
export function normalizedTitle(s: string): string {
  return [...new Set(tokens(s))].sort().join(" ");
}
