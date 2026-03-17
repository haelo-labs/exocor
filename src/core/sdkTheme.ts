import { useEffect, useState } from 'react';
import { isSdkUiElement } from './sdkUi';

export type SdkThemeMode = 'light' | 'dark';

type RgbaColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

type StatusTone = {
  dot: string;
  ring: string;
};

export interface SdkTheme {
  mode: SdkThemeMode;
  panelSurface: string;
  panelInsetSurface: string;
  panelNestedSurface: string;
  panelBorder: string;
  panelShadow: string;
  entryPointShadow: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textSubtle: string;
  inputSurface: string;
  inputBorder: string;
  inputDivider: string;
  inputPlaceholder: string;
  sendButtonSurface: string;
  sendButtonHoverSurface: string;
  sendButtonPressedSurface: string;
  sendButtonInactiveIcon: string;
  sendButtonActiveIcon: string;
  clearButtonHoverSurface: string;
  clearButtonPressedSurface: string;
  clearButtonDefaultIcon: string;
  clearButtonActiveIcon: string;
  toggleActiveBackground: string;
  toggleActiveText: string;
  toggleInactiveBackground: string;
  toggleInactiveText: string;
  iconMuted: string;
  hoverSurface: string;
  hoverRing: string;
  hoverRingShadow: string;
  gazeRing: string;
  gazeGlow: string;
  gazeCenter: string;
  gazeClickRing: string;
  gazeClickGlow: string;
  gazeClickCenter: string;
  dragRing: string;
  dragGlow: string;
  dragCenter: string;
  toastSurface: string;
  toastBorder: string;
  toastText: string;
  toastFailedSurface: string;
  toastFailedBorder: string;
  toastFailedText: string;
  statusLineColor: string;
  clarificationSurface: string;
  clarificationBorder: string;
  clarificationShadow: string;
  clarificationTextWeight: number;
  discoverySurface: string;
  discoveryBorder: string;
  discoveryBackdrop: string;
  discoveryProgressTrack: string;
  discoveryProgressBar: string;
  status: {
    idle: StatusTone;
    listening: StatusTone;
    executing: StatusTone;
  };
}

const TRANSPARENT: RgbaColor = { r: 255, g: 255, b: 255, a: 0 };
const OPAQUE_WHITE: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };

const LIGHT_THEME: SdkTheme = {
  mode: 'light',
  panelSurface: '#ffffff',
  panelInsetSurface: '#f4f4f4',
  panelNestedSurface: '#ebebeb',
  panelBorder: '#e0e0e0',
  panelShadow: '-2px 4px 24px rgba(0, 0, 0, 0.35)',
  entryPointShadow: '1px 2px 16px rgba(0, 0, 0, 0.18)',
  textPrimary: '#161616',
  textSecondary: '#393939',
  textMuted: '#a8a8a8',
  textSubtle: '#6f6f6f',
  inputSurface: '#f4f4f4',
  inputBorder: '#e0e0e0',
  inputDivider: '#e0e0e0',
  inputPlaceholder: '#a8a8a8',
  sendButtonSurface: '#f4f4f4',
  sendButtonHoverSurface: '#e0e0e0',
  sendButtonPressedSurface: '#c6c6c6',
  sendButtonInactiveIcon: '#a8a8a8',
  sendButtonActiveIcon: '#161616',
  clearButtonHoverSurface: '#f4f4f4',
  clearButtonPressedSurface: '#e0e0e0',
  clearButtonDefaultIcon: '#a8a8a8',
  clearButtonActiveIcon: '#393939',
  toggleActiveBackground: 'rgba(36, 161, 72, 0.2)',
  toggleActiveText: '#198038',
  toggleInactiveBackground: '#f4f4f4',
  toggleInactiveText: '#a8a8a8',
  iconMuted: '#6f6f6f',
  hoverSurface: '#f4f4f4',
  hoverRing: '#393939',
  hoverRingShadow: 'rgba(0, 0, 0, 0.2)',
  gazeRing: '#393939',
  gazeGlow: '0 0 6px rgba(0, 0, 0, 0.2)',
  gazeCenter: '#393939',
  gazeClickRing: '#f1c21b',
  gazeClickGlow: '0 0 4px rgba(241, 194, 27, 0.35)',
  gazeClickCenter: '#f1c21b',
  dragRing: '#f1c21b',
  dragGlow: '0 0 10px rgba(241, 194, 27, 0.24)',
  dragCenter: '#f1c21b',
  toastSurface: '#f4f4f4',
  toastBorder: '#e0e0e0',
  toastText: '#161616',
  toastFailedSurface: '#da1e28',
  toastFailedBorder: '#fa4d56',
  toastFailedText: '#f4f4f4',
  statusLineColor: '#8d8d8d',
  clarificationSurface: '#ffffff',
  clarificationBorder: '#e0e0e0',
  clarificationShadow: '2px 4px 24px rgba(0, 0, 0, 0.2)',
  clarificationTextWeight: 400,
  discoverySurface: '#ffffff',
  discoveryBorder: '#e0e0e0',
  discoveryBackdrop: 'rgba(255, 255, 255, 0.1)',
  discoveryProgressTrack: 'rgba(57, 57, 57, 0.12)',
  discoveryProgressBar: 'linear-gradient(90deg, rgba(57, 57, 57, 0.05), rgba(57, 57, 57, 0.6), rgba(57, 57, 57, 0.05))',
  status: {
    idle: { dot: '#c6c6c6', ring: 'transparent' },
    listening: { dot: '#42be65', ring: 'rgba(66, 190, 101, 0.3)' },
    executing: { dot: '#ff832b', ring: 'rgba(255, 131, 43, 0.3)' }
  }
};

const DARK_THEME: SdkTheme = {
  mode: 'dark',
  panelSurface: '#161616',
  panelInsetSurface: '#262626',
  panelNestedSurface: '#393939',
  panelBorder: '#262626',
  panelShadow: '-2px 4px 24px rgba(0, 0, 0, 0.35)',
  entryPointShadow: '1px 2px 16px rgba(0, 0, 0, 0.8)',
  textPrimary: '#f4f4f4',
  textSecondary: '#c6c6c6',
  textMuted: '#a8a8a8',
  textSubtle: '#c6c6c6',
  inputSurface: '#262626',
  inputBorder: '#262626',
  inputDivider: '#262626',
  inputPlaceholder: '#c6c6c6',
  sendButtonSurface: '#262626',
  sendButtonHoverSurface: '#1a1a1a',
  sendButtonPressedSurface: '#000000',
  sendButtonInactiveIcon: '#6f6f6f',
  sendButtonActiveIcon: '#f4f4f4',
  clearButtonHoverSurface: '#1a1a1a',
  clearButtonPressedSurface: '#000000',
  clearButtonDefaultIcon: '#6f6f6f',
  clearButtonActiveIcon: '#f4f4f4',
  toggleActiveBackground: '#0e6027',
  toggleActiveText: '#f4f4f4',
  toggleInactiveBackground: '#262626',
  toggleInactiveText: '#a8a8a8',
  iconMuted: '#a8a8a8',
  hoverSurface: '#000000',
  hoverRing: '#f4f4f4',
  hoverRingShadow: 'rgba(244, 244, 244, 0.2)',
  gazeRing: '#f4f4f4',
  gazeGlow: '0 0 6px rgba(255, 255, 255, 0.3)',
  gazeCenter: '#f4f4f4',
  gazeClickRing: '#f1c21b',
  gazeClickGlow: '0 0 4px rgba(241, 194, 27, 0.35)',
  gazeClickCenter: '#f1c21b',
  dragRing: '#f1c21b',
  dragGlow: '0 0 10px rgba(241, 194, 27, 0.24)',
  dragCenter: '#f1c21b',
  toastSurface: '#161616',
  toastBorder: '#262626',
  toastText: '#f4f4f4',
  toastFailedSurface: '#750e13',
  toastFailedBorder: '#262626',
  toastFailedText: '#f4f4f4',
  statusLineColor: '#c6c6c6',
  clarificationSurface: '#161616',
  clarificationBorder: '#262626',
  clarificationShadow: '2px 4px 24px rgba(0, 0, 0, 0.8)',
  clarificationTextWeight: 400,
  discoverySurface: '#161616',
  discoveryBorder: '#262626',
  discoveryBackdrop: 'rgba(0, 0, 0, 0.4)',
  discoveryProgressTrack: 'rgba(244, 244, 244, 0.12)',
  discoveryProgressBar: 'linear-gradient(90deg, rgba(244, 244, 244, 0.05), rgba(244, 244, 244, 0.48), rgba(244, 244, 244, 0.05))',
  status: {
    idle: { dot: '#a8a8a8', ring: 'transparent' },
    listening: { dot: '#24a148', ring: 'rgba(66, 190, 101, 0.3)' },
    executing: { dot: '#eb6200', ring: 'rgba(255, 131, 43, 0.3)' }
  }
};

function parseColor(value: string | null | undefined): RgbaColor | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'transparent') {
    return TRANSPARENT;
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const channels = rgbMatch[1]
      .split(',')
      .map((part) => Number.parseFloat(part.trim()))
      .filter((part) => Number.isFinite(part));
    if (channels.length >= 3) {
      return {
        r: clampChannel(channels[0]),
        g: clampChannel(channels[1]),
        b: clampChannel(channels[2]),
        a: clampAlpha(channels[3] ?? 1)
      };
    }
  }

  const hexMatch = normalized.match(/^#([a-f0-9]{3,8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: Number.parseInt(`${hex[0]}${hex[0]}`, 16),
        g: Number.parseInt(`${hex[1]}${hex[1]}`, 16),
        b: Number.parseInt(`${hex[2]}${hex[2]}`, 16),
        a: hex.length === 4 ? Number.parseInt(`${hex[3]}${hex[3]}`, 16) / 255 : 1
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
      };
    }
  }

  return null;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampAlpha(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function compositeColors(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha <= 0) {
    return TRANSPARENT;
  }

  return {
    r: Math.round((foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha),
    g: Math.round((foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha),
    b: Math.round((foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha),
    a: alpha
  };
}

function toLinearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RgbaColor): number {
  return (
    0.2126 * toLinearChannel(color.r) +
    0.7152 * toLinearChannel(color.g) +
    0.0722 * toLinearChannel(color.b)
  );
}

function getBaseDocumentColor(): RgbaColor {
  if (typeof document === 'undefined') {
    return OPAQUE_WHITE;
  }

  const htmlColor = parseColor(getComputedStyle(document.documentElement).backgroundColor) ?? TRANSPARENT;
  const bodyColor = parseColor(getComputedStyle(document.body).backgroundColor) ?? TRANSPARENT;
  return compositeColors(bodyColor, compositeColors(htmlColor, OPAQUE_WHITE));
}

function samplePointColor(target: Element | null): RgbaColor {
  const base = getBaseDocumentColor();
  if (!(target instanceof HTMLElement)) {
    return base;
  }

  const layers: RgbaColor[] = [];
  let current: HTMLElement | null = target;
  while (current && current !== document.body && current !== document.documentElement) {
    const nextColor = parseColor(getComputedStyle(current).backgroundColor);
    if (nextColor && nextColor.a > 0) {
      layers.unshift(nextColor);
    }
    current = current.parentElement;
  }

  return layers.reduce((composite, layer) => compositeColors(layer, composite), base);
}

function sampleDocumentLuminance(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 0;
  }

  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const fractions = [0.18, 0.5, 0.82];
  const colors: RgbaColor[] = [];

  for (const xFraction of fractions) {
    for (const yFraction of fractions) {
      const x = Math.round(width * xFraction);
      const y = Math.round(height * yFraction);
      const elements =
        typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
      const target =
        elements.find((element) => {
          if (isSdkUiElement(element)) {
            return false;
          }
          if (element === document.documentElement || element === document.body) {
            return false;
          }
          if (!(element instanceof HTMLElement)) {
            return false;
          }
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }) ?? null;
      colors.push(samplePointColor(target));
    }
  }

  if (!colors.length) {
    return relativeLuminance(getBaseDocumentColor());
  }

  return colors.reduce((sum, color) => sum + relativeLuminance(color), 0) / colors.length;
}

function inferThemeMode(previousMode: SdkThemeMode): SdkThemeMode {
  const luminance = sampleDocumentLuminance();
  if (luminance <= 0.46) {
    return 'dark';
  }
  if (luminance >= 0.54) {
    return 'light';
  }
  return previousMode;
}

export function resolveSdkTheme(mode: SdkThemeMode): SdkTheme {
  return mode === 'light' ? LIGHT_THEME : DARK_THEME;
}

export function useSdkThemeMode(): SdkThemeMode {
  const [mode, setMode] = useState<SdkThemeMode>(() => {
    if (typeof document === 'undefined') {
      return 'dark';
    }
    return inferThemeMode('dark');
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    let frameId = 0;
    const sample = (): void => {
      frameId = 0;
      setMode((previous) => inferThemeMode(previous));
    };

    const scheduleSample = (): void => {
      if (frameId) {
        return;
      }
      frameId = window.requestAnimationFrame(sample);
    };

    scheduleSample();

    const rootObserver = new MutationObserver(scheduleSample);
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    const bodyObserver = new MutationObserver(scheduleSample);
    if (document.body) {
      bodyObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }

    const intervalId = window.setInterval(scheduleSample, 2000);

    window.addEventListener('resize', scheduleSample);
    window.addEventListener('scroll', scheduleSample, true);
    document.addEventListener('visibilitychange', scheduleSample);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      rootObserver.disconnect();
      bodyObserver.disconnect();
      window.clearInterval(intervalId);
      window.removeEventListener('resize', scheduleSample);
      window.removeEventListener('scroll', scheduleSample, true);
      document.removeEventListener('visibilitychange', scheduleSample);
    };
  }, []);

  return mode;
}
