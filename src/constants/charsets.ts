export interface CharGroup {
  id: string
  label: string
  characters: string[]
  special?: boolean  // true = hidden unless special chars enabled
}

export const CHAR_GROUPS: CharGroup[] = [
  {
    id: 'uppercase',
    label: 'Uppercase',
    characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  },
  {
    id: 'lowercase',
    label: 'Lowercase',
    characters: 'abcdefghijklmnopqrstuvwxyz'.split(''),
  },
  {
    id: 'numbers',
    label: 'Numbers',
    characters: '0123456789'.split(''),
  },
  {
    id: 'punctuation',
    label: 'Punctuation',
    characters: [
      '!', '"', '#', '$', '%', '&', "'", '(',
      ')', '*', '+', ',', '-', '.', '/', ':',
      ';', '<', '=', '>', '?', '@', '[', '\\',
      ']', '^', '_', '`', '{', '|', '}', '~',
    ],
  },
  {
    id: 'special',
    label: 'Special characters',
    special: true,
    characters: [
      // Currency
      '€', '£', '¥', '¢', '₹', '₩', '₿',
      // Math
      '±', '×', '÷', '≠', '≈', '≤', '≥', '∞', '√', '∑', '∏', 'π',
      // Arrows
      '←', '→', '↑', '↓', '↔', '↕',
      // Typography
      '\u2026', '\u2013', '\u2014', '\u201C', '\u201D', '\u2018', '\u2019', '\u00AB', '\u00BB', '\u2039', '\u203A',
      '•', '·', '†', '‡', '§', '¶', '©', '®', '™',
      // Accented Latin (common)
      'À', 'Á', 'Â', 'Ã', 'Ä', 'Å', 'Æ', 'Ç',
      'È', 'É', 'Ê', 'Ë', 'Ì', 'Í', 'Î', 'Ï',
      'Ð', 'Ñ', 'Ò', 'Ó', 'Ô', 'Õ', 'Ö', 'Ø',
      'Ù', 'Ú', 'Û', 'Ü', 'Ý', 'Þ', 'ß',
      'à', 'á', 'â', 'ã', 'ä', 'å', 'æ', 'ç',
      'è', 'é', 'ê', 'ë', 'ì', 'í', 'î', 'ï',
      'ð', 'ñ', 'ò', 'ó', 'ô', 'õ', 'ö', 'ø',
      'ù', 'ú', 'û', 'ü', 'ý', 'þ', 'ÿ',
    ],
  },
]

// All default (non-special) characters flat list
export const DEFAULT_CHARACTERS = CHAR_GROUPS
  .filter(g => !g.special)
  .flatMap(g => g.characters)

// All characters including special
export const ALL_CHARACTERS = CHAR_GROUPS.flatMap(g => g.characters)

// Get codepoint string from character
export function toCodepoint(char: string): string {
  const cp = char.codePointAt(0)!
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}
