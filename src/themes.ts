export interface Theme {
  id: string;
  name: string;
  label: string;
  css: {
    appBg: string;
    pixiBg: string;
    canvasBorder: string;
    panelBg: string;
    panelBgSolid: string;
    panelBorder: string;
    text: string;
    textMuted: string;
  };
}

export const THEMES: Theme[] = [
  {
    id: 'dark',
    name: 'Dark Office',
    label: 'DARK',
    css: {
      appBg: '#1a1a2e',
      pixiBg: '#2a2a3e',
      canvasBorder: '#4d5570',
      panelBg: 'rgba(10, 12, 18, 0.75)',
      panelBgSolid: '#0a0c12',
      panelBorder: '#4a5167',
      text: '#e8edf5',
      textMuted: 'rgba(255, 255, 255, 0.5)',
    },
  },
  {
    id: 'bright',
    name: 'Bright Startup',
    label: 'BRIGHT',
    css: {
      appBg: '#e8e4df',
      pixiBg: '#d4cfc8',
      canvasBorder: '#b0a899',
      panelBg: 'rgba(255, 252, 247, 0.82)',
      panelBgSolid: '#fffcf7',
      panelBorder: '#c4b9a8',
      text: '#2c2418',
      textMuted: 'rgba(44, 36, 24, 0.5)',
    },
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Neon',
    label: 'NEON',
    css: {
      appBg: '#08060f',
      pixiBg: '#0d0a18',
      canvasBorder: '#ff00ff',
      panelBg: 'rgba(8, 4, 20, 0.85)',
      panelBgSolid: '#080414',
      panelBorder: '#00ffff55',
      text: '#e0f0ff',
      textMuted: 'rgba(0, 255, 255, 0.5)',
    },
  },
  {
    id: 'retro',
    name: 'Retro Terminal',
    label: 'RETRO',
    css: {
      appBg: '#0a0a0a',
      pixiBg: '#0c0c0c',
      canvasBorder: '#00ff41',
      panelBg: 'rgba(0, 8, 0, 0.82)',
      panelBgSolid: '#000800',
      panelBorder: '#00ff4133',
      text: '#00ff41',
      textMuted: 'rgba(0, 255, 65, 0.45)',
    },
  },
];

export const DEFAULT_THEME = THEMES[0];

export function getThemeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}
