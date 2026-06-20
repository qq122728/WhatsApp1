import type { DetectedLanguage } from "./types";

const HAN_CHARACTER = /\p{Script=Han}/u;
const LATIN_CHARACTER = /\p{Script=Latin}/u;
const HAN_WEIGHT = 2.5;
const MIN_DOMINANCE = 0.6;

/**
 * Lightweight script-based detection for the MVP's Chinese/English scope.
 * Mixed or non-linguistic input intentionally resolves to "unknown".
 */
export function detectLanguage(text: string): DetectedLanguage {
  let chineseCharacterCount = 0;
  let latinCharacterCount = 0;

  for (const character of text) {
    if (HAN_CHARACTER.test(character)) {
      chineseCharacterCount += 1;
    } else if (LATIN_CHARACTER.test(character)) {
      latinCharacterCount += 1;
    }
  }

  const chineseScore = chineseCharacterCount * HAN_WEIGHT;
  const englishScore = latinCharacterCount;
  const totalScore = chineseScore + englishScore;

  if (totalScore === 0) {
    return {
      language: "unknown",
      confidence: 0,
      chineseCharacterCount,
      latinCharacterCount,
    };
  }

  const chineseConfidence = chineseScore / totalScore;
  const englishConfidence = englishScore / totalScore;

  if (chineseConfidence >= MIN_DOMINANCE) {
    return {
      language: "zh",
      confidence: chineseConfidence,
      chineseCharacterCount,
      latinCharacterCount,
    };
  }

  if (englishConfidence >= MIN_DOMINANCE) {
    return {
      language: "en",
      confidence: englishConfidence,
      chineseCharacterCount,
      latinCharacterCount,
    };
  }

  return {
    language: "unknown",
    confidence: Math.max(chineseConfidence, englishConfidence),
    chineseCharacterCount,
    latinCharacterCount,
  };
}
