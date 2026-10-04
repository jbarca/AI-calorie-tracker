const tintColorLight = '#2f95dc';
const tintColorDark = '#fff';

export default {
  light: {
    text: '#000',
    background: '#fff',
    tint: tintColorLight,
    tabIconDefault: '#ccc',
    tabIconSelected: tintColorLight,
    muted: '#6b7280',
    card: '#f3f4f6',
    border: '#e5e7eb',
    accent: '#2f95dc',
    danger: '#dc2626',
    track: '#e5e7eb',
  },
  dark: {
    text: '#fff',
    background: '#000',
    tint: tintColorDark,
    tabIconDefault: '#ccc',
    tabIconSelected: tintColorDark,
    muted: '#9ca3af',
    card: '#1c1c1e',
    border: '#2c2c2e',
    accent: '#4aa8e8',
    danger: '#f87171',
    track: '#2c2c2e',
  },
};

/** Fixed series colours (same in both themes; each passes contrast on light and dark). */
export const MacroColors = {
  protein: '#e0699b',
  carbs: '#e8a33d',
  fat: '#5b8def',
  over: '#dc2626',
} as const;
