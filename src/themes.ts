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
    accentColor: string;
  };
}

export const THEMES: Theme[] = [
  {
    id: 'dark',
    name: 'Dark Office',
    label: 'DARK',
    css: {
      appBg: '#151d2b',
      pixiBg: '#273449',
      canvasBorder: '#33455e',
      panelBg: '#1d293a',
      panelBgSolid: '#1d293a',
      panelBorder: '#33455e',
      text: '#eef3fb',
      textMuted: '#a9b8cb',
      accentColor: '#79b8ef',
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
      textMuted: '#675e50',
      accentColor: '#0288d1',
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
      textMuted: '#86baba',
      accentColor: '#00e5ff',
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
      textMuted: '#6eaf80',
      accentColor: '#4fc3f7',
    },
  },
];

export const DEFAULT_THEME = THEMES[0];

export function getThemeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}
