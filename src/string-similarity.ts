/**
 * Levenshtein distance: minimum single-character edits to transform a into b.
 */
export function levenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  
  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= aLower.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= bLower.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= aLower.length; i++) {
    for (let j = 1; j <= bLower.length; j++) {
      const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[aLower.length][bLower.length];
}

export function similarityRatio(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLength;
}

export interface ClosestMatch<T> {
  item: T;
  distance: number;
  similarity: number;
}

export function findClosestMatch<T>(
  query: string,
  items: T[],
  getKey: (item: T) => string
): ClosestMatch<T> | null {
  if (items.length === 0) return null;

  let bestMatch: ClosestMatch<T> | null = null;

  for (const item of items) {
    const key = getKey(item);
    const distance = levenshteinDistance(query, key);
    const similarity = similarityRatio(query, key);

    if (!bestMatch || distance < bestMatch.distance || (distance === bestMatch.distance && similarity > bestMatch.similarity)) {
      bestMatch = { item, distance, similarity };
    }
  }

  return bestMatch;
}

export function findClosestMatchMultiKey<T>(
  query: string,
  items: T[],
  getKeys: (item: T) => string[]
): ClosestMatch<T> | null {
  if (items.length === 0) return null;

  let bestMatch: ClosestMatch<T> | null = null;

  for (const item of items) {
    const keys = getKeys(item);
    
    for (const key of keys) {
      const distance = levenshteinDistance(query, key);
      const similarity = similarityRatio(query, key);

      const isBetterMatch = !bestMatch || 
        distance < bestMatch.distance || 
        (distance === bestMatch.distance && similarity > bestMatch.similarity);
      
      if (isBetterMatch) {
        bestMatch = { item, distance, similarity };
      }
    }
  }

  return bestMatch;
}
