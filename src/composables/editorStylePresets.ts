export interface PresetColors {
  codeBg: string
  codeBorder: string
  codeText: string
  inlineCodeBg: string
  inlineCodeText: string
  blockquoteBg: string
  blockquoteBorder: string
  blockquoteText: string
}

export interface PresetDefinition {
  name: string
  light: PresetColors
  dark: PresetColors
}

export const editorStylePresets: Record<string, PresetDefinition> = {
  default: {
    name: '默认',
    light: {
      codeBg: 'rgba(240, 240, 245, 0.75)',
      codeBorder: 'rgba(200, 205, 215, 0.5)',
      codeText: '#374151',
      inlineCodeBg: 'rgba(237, 238, 244, 0.8)',
      inlineCodeText: '#d63384',
      blockquoteBg: 'rgba(245, 246, 250, 0.5)',
      blockquoteBorder: 'rgba(156, 163, 175, 0.45)',
      blockquoteText: '#6b7280',
    },
    dark: {
      codeBg: 'rgba(30, 33, 40, 0.8)',
      codeBorder: 'rgba(55, 60, 70, 0.5)',
      codeText: '#c9d1d9',
      inlineCodeBg: 'rgba(30, 33, 40, 0.8)',
      inlineCodeText: '#f0a0c0',
      blockquoteBg: 'rgba(35, 38, 45, 0.5)',
      blockquoteBorder: 'rgba(100, 110, 130, 0.45)',
      blockquoteText: '#9ca3af',
    },
  },

  minimal: {
    name: '极简',
    light: {
      codeBg: 'rgba(245, 245, 248, 0.35)',
      codeBorder: 'rgba(210, 215, 225, 0.2)',
      codeText: '#444444',
      inlineCodeBg: 'rgba(245, 245, 248, 0.4)',
      inlineCodeText: '#6b7280',
      blockquoteBg: 'transparent',
      blockquoteBorder: 'rgba(200, 205, 215, 0.3)',
      blockquoteText: '#6b7280',
    },
    dark: {
      codeBg: 'rgba(25, 28, 32, 0.4)',
      codeBorder: 'rgba(50, 55, 65, 0.2)',
      codeText: '#a8b0b8',
      inlineCodeBg: 'rgba(25, 28, 32, 0.4)',
      inlineCodeText: '#9ca3af',
      blockquoteBg: 'transparent',
      blockquoteBorder: 'rgba(75, 80, 90, 0.3)',
      blockquoteText: '#9ca3af',
    },
  },

  amber: {
    name: '琥珀',
    light: {
      codeBg: 'rgba(255, 248, 235, 0.75)',
      codeBorder: 'rgba(251, 191, 36, 0.3)',
      codeText: '#5c4200',
      inlineCodeBg: 'rgba(255, 248, 235, 0.7)',
      inlineCodeText: '#b45309',
      blockquoteBg: 'rgba(255, 251, 235, 0.5)',
      blockquoteBorder: 'rgba(251, 191, 36, 0.5)',
      blockquoteText: '#78350f',
    },
    dark: {
      codeBg: 'rgba(40, 32, 10, 0.8)',
      codeBorder: 'rgba(245, 158, 11, 0.3)',
      codeText: '#fde68a',
      inlineCodeBg: 'rgba(40, 32, 10, 0.7)',
      inlineCodeText: '#fbbf24',
      blockquoteBg: 'rgba(42, 35, 15, 0.5)',
      blockquoteBorder: 'rgba(245, 158, 11, 0.5)',
      blockquoteText: '#fcd34d',
    },
  },

  slate: {
    name: '岩板',
    light: {
      codeBg: 'rgba(241, 245, 249, 0.8)',
      codeBorder: 'rgba(148, 163, 184, 0.35)',
      codeText: '#334155',
      inlineCodeBg: 'rgba(241, 245, 249, 0.8)',
      inlineCodeText: '#0f766e',
      blockquoteBg: 'rgba(248, 250, 252, 0.55)',
      blockquoteBorder: 'rgba(100, 116, 139, 0.5)',
      blockquoteText: '#475569',
    },
    dark: {
      codeBg: 'rgba(30, 41, 59, 0.8)',
      codeBorder: 'rgba(71, 85, 105, 0.35)',
      codeText: '#cbd5e1',
      inlineCodeBg: 'rgba(30, 41, 59, 0.8)',
      inlineCodeText: '#5eead4',
      blockquoteBg: 'rgba(30, 41, 59, 0.5)',
      blockquoteBorder: 'rgba(100, 116, 139, 0.5)',
      blockquoteText: '#94a3b8',
    },
  },

  ocean: {
    name: '海洋',
    light: {
      codeBg: 'rgba(236, 245, 255, 0.75)',
      codeBorder: 'rgba(96, 165, 250, 0.3)',
      codeText: '#1e3a5f',
      inlineCodeBg: 'rgba(236, 245, 255, 0.7)',
      inlineCodeText: '#0369a1',
      blockquoteBg: 'rgba(239, 246, 255, 0.5)',
      blockquoteBorder: 'rgba(59, 130, 246, 0.45)',
      blockquoteText: '#1e40af',
    },
    dark: {
      codeBg: 'rgba(12, 28, 52, 0.8)',
      codeBorder: 'rgba(59, 130, 246, 0.3)',
      codeText: '#93c5fd',
      inlineCodeBg: 'rgba(12, 28, 52, 0.7)',
      inlineCodeText: '#7dd3fc',
      blockquoteBg: 'rgba(15, 30, 55, 0.5)',
      blockquoteBorder: 'rgba(59, 130, 246, 0.45)',
      blockquoteText: '#93bbf0',
    },
  },

  rose: {
    name: '玫瑰',
    light: {
      codeBg: 'rgba(255, 241, 242, 0.7)',
      codeBorder: 'rgba(251, 113, 133, 0.3)',
      codeText: '#881337',
      inlineCodeBg: 'rgba(255, 241, 242, 0.7)',
      inlineCodeText: '#be123c',
      blockquoteBg: 'rgba(255, 241, 242, 0.45)',
      blockquoteBorder: 'rgba(244, 114, 182, 0.5)',
      blockquoteText: '#9d174d',
    },
    dark: {
      codeBg: 'rgba(45, 14, 28, 0.8)',
      codeBorder: 'rgba(251, 113, 133, 0.3)',
      codeText: '#fecdd3',
      inlineCodeBg: 'rgba(45, 14, 28, 0.7)',
      inlineCodeText: '#fda4af',
      blockquoteBg: 'rgba(48, 18, 32, 0.5)',
      blockquoteBorder: 'rgba(244, 114, 182, 0.45)',
      blockquoteText: '#f9a8d4',
    },
  },

  forest: {
    name: '森林',
    light: {
      codeBg: 'rgba(236, 252, 243, 0.7)',
      codeBorder: 'rgba(74, 222, 128, 0.3)',
      codeText: '#14532d',
      inlineCodeBg: 'rgba(236, 252, 243, 0.65)',
      inlineCodeText: '#15803d',
      blockquoteBg: 'rgba(240, 253, 244, 0.45)',
      blockquoteBorder: 'rgba(34, 197, 94, 0.45)',
      blockquoteText: '#166534',
    },
    dark: {
      codeBg: 'rgba(8, 32, 16, 0.8)',
      codeBorder: 'rgba(74, 222, 128, 0.3)',
      codeText: '#bbf7d0',
      inlineCodeBg: 'rgba(8, 32, 16, 0.7)',
      inlineCodeText: '#86efac',
      blockquoteBg: 'rgba(10, 35, 20, 0.5)',
      blockquoteBorder: 'rgba(34, 197, 94, 0.45)',
      blockquoteText: '#bbf7ba',
    },
  },

  lavender: {
    name: '薰衣草',
    light: {
      codeBg: 'rgba(245, 243, 255, 0.7)',
      codeBorder: 'rgba(167, 139, 250, 0.3)',
      codeText: '#4c1d95',
      inlineCodeBg: 'rgba(245, 243, 255, 0.65)',
      inlineCodeText: '#7c3aed',
      blockquoteBg: 'rgba(245, 243, 255, 0.45)',
      blockquoteBorder: 'rgba(167, 139, 250, 0.45)',
      blockquoteText: '#5b21b6',
    },
    dark: {
      codeBg: 'rgba(30, 18, 60, 0.8)',
      codeBorder: 'rgba(167, 139, 250, 0.3)',
      codeText: '#ddd6fe',
      inlineCodeBg: 'rgba(30, 18, 60, 0.7)',
      inlineCodeText: '#c4b5fd',
      blockquoteBg: 'rgba(32, 22, 62, 0.5)',
      blockquoteBorder: 'rgba(167, 139, 250, 0.45)',
      blockquoteText: '#c4b5fd',
    },
  },

  dusk: {
    name: '暮光',
    light: {
      codeBg: 'rgba(255, 237, 213, 0.7)',
      codeBorder: 'rgba(253, 186, 116, 0.3)',
      codeText: '#7c2d12',
      inlineCodeBg: 'rgba(255, 237, 213, 0.65)',
      inlineCodeText: '#c2410c',
      blockquoteBg: 'rgba(255, 245, 235, 0.45)',
      blockquoteBorder: 'rgba(249, 115, 22, 0.45)',
      blockquoteText: '#9a3412',
    },
    dark: {
      codeBg: 'rgba(50, 25, 10, 0.8)',
      codeBorder: 'rgba(253, 186, 116, 0.3)',
      codeText: '#fed7aa',
      inlineCodeBg: 'rgba(50, 25, 10, 0.7)',
      inlineCodeText: '#fb923c',
      blockquoteBg: 'rgba(52, 28, 14, 0.5)',
      blockquoteBorder: 'rgba(249, 115, 22, 0.45)',
      blockquoteText: '#fdba74',
    },
  },

  paper: {
    name: '纸墨',
    light: {
      codeBg: 'rgba(253, 252, 248, 0.85)',
      codeBorder: 'rgba(200, 195, 180, 0.5)',
      codeText: '#3d3826',
      inlineCodeBg: 'rgba(253, 252, 248, 0.8)',
      inlineCodeText: '#a16207',
      blockquoteBg: 'rgba(250, 249, 244, 0.6)',
      blockquoteBorder: 'rgba(180, 170, 145, 0.5)',
      blockquoteText: '#5c5540',
    },
    dark: {
      codeBg: 'rgba(40, 36, 28, 0.85)',
      codeBorder: 'rgba(100, 90, 75, 0.45)',
      codeText: '#e8e0c8',
      inlineCodeBg: 'rgba(40, 36, 28, 0.8)',
      inlineCodeText: '#f2c94c',
      blockquoteBg: 'rgba(42, 38, 30, 0.6)',
      blockquoteBorder: 'rgba(140, 125, 100, 0.5)',
      blockquoteText: '#d4c9a8',
    },
  },

  ink: {
    name: '墨染',
    light: {
      codeBg: 'rgba(248, 248, 248, 0.9)',
      codeBorder: 'rgba(180, 180, 180, 0.5)',
      codeText: '#1a1a1a',
      inlineCodeBg: 'rgba(248, 248, 248, 0.85)',
      inlineCodeText: '#000000',
      blockquoteBg: 'rgba(250, 250, 250, 0.6)',
      blockquoteBorder: 'rgba(80, 80, 80, 0.55)',
      blockquoteText: '#333333',
    },
    dark: {
      codeBg: 'rgba(18, 18, 20, 0.9)',
      codeBorder: 'rgba(80, 80, 85, 0.5)',
      codeText: '#e8e8e8',
      inlineCodeBg: 'rgba(18, 18, 20, 0.85)',
      inlineCodeText: '#ffffff',
      blockquoteBg: 'rgba(20, 20, 22, 0.6)',
      blockquoteBorder: 'rgba(120, 120, 125, 0.5)',
      blockquoteText: '#cccccc',
    },
  },

  coral: {
    name: '珊瑚',
    light: {
      codeBg: 'rgba(255, 245, 245, 0.7)',
      codeBorder: 'rgba(252, 129, 129, 0.3)',
      codeText: '#7f1d1d',
      inlineCodeBg: 'rgba(255, 245, 245, 0.65)',
      inlineCodeText: '#e53e3e',
      blockquoteBg: 'rgba(255, 245, 245, 0.45)',
      blockquoteBorder: 'rgba(245, 101, 101, 0.45)',
      blockquoteText: '#9b2c2c',
    },
    dark: {
      codeBg: 'rgba(40, 12, 12, 0.8)',
      codeBorder: 'rgba(252, 129, 129, 0.3)',
      codeText: '#fecaca',
      inlineCodeBg: 'rgba(40, 12, 12, 0.7)',
      inlineCodeText: '#fc8181',
      blockquoteBg: 'rgba(42, 14, 14, 0.5)',
      blockquoteBorder: 'rgba(245, 101, 101, 0.45)',
      blockquoteText: '#fca5a5',
    },
  },

  moss: {
    name: '苔藓',
    light: {
      codeBg: 'rgba(244, 250, 240, 0.7)',
      codeBorder: 'rgba(166, 211, 141, 0.35)',
      codeText: '#3f6212',
      inlineCodeBg: 'rgba(244, 250, 240, 0.65)',
      inlineCodeText: '#4d7c0f',
      blockquoteBg: 'rgba(247, 252, 245, 0.5)',
      blockquoteBorder: 'rgba(132, 204, 22, 0.4)',
      blockquoteText: '#365314',
    },
    dark: {
      codeBg: 'rgba(14, 30, 8, 0.8)',
      codeBorder: 'rgba(166, 211, 141, 0.3)',
      codeText: '#bef264',
      inlineCodeBg: 'rgba(14, 30, 8, 0.7)',
      inlineCodeText: '#a3e635',
      blockquoteBg: 'rgba(16, 32, 10, 0.5)',
      blockquoteBorder: 'rgba(132, 204, 22, 0.4)',
      blockquoteText: '#a3e635',
    },
  },
}
