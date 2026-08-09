import { describe, expect, it } from 'vitest';

import { controlStyles } from '../src/control-view.js';

const READOUT_ICON_PX = 16;

// Measured in Chromium with Roboto on the dev dashboard, since jsdom lays out no text.
const chromiumTextPx = {
  temperature: 49.56,
  humidity: 32.05,
  brightness: 26.41,
};

const SPARE_PX = 4;

function declarations(selector: string): CSSStyleDeclaration {
  const sheet = new CSSStyleSheet();

  sheet.replaceSync(controlStyles.cssText);

  const rule = [...sheet.cssRules].find(
    (candidate): candidate is CSSStyleRule =>
      candidate instanceof CSSStyleRule && candidate.selectorText === selector,
  );

  if (!rule) throw new Error(`no ${selector} rule in the control styles`);

  return rule.style;
}

function px(value: string): number {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) throw new Error(`not a length: ${value}`);

  return parsed;
}

function sides(shorthand: string): { left: number; right: number } {
  const values = shorthand.trim().split(/\s+/).map(px);
  const right = values[1] ?? values[0];

  return { right, left: values[3] ?? right };
}

function roomLineWidth(): number {
  const gap = px(declarations('.room-line').getPropertyValue('column-gap'));
  const readoutGap = px(declarations('.readout').getPropertyValue('gap'));
  const lamp = declarations('.lamp');
  const lampPadding = sides(lamp.getPropertyValue('padding'));
  const lampBorder = px(lamp.getPropertyValue('border'));
  const lampIcon = px(declarations('.lamp-icon').getPropertyValue('width'));

  const temperature = READOUT_ICON_PX + readoutGap + chromiumTextPx.temperature;
  const humidity = READOUT_ICON_PX + readoutGap + chromiumTextPx.humidity;
  const light =
    2 * lampBorder +
    lampPadding.left +
    lampIcon +
    px(lamp.getPropertyValue('gap')) +
    chromiumTextPx.brightness +
    lampPadding.right;

  return temperature + gap + humidity + gap + light;
}

function dockedSheetInside(): number {
  const width = px(
    declarations('.sheet:not(.bottom)').getPropertyValue('width'),
  );
  const sheet = declarations('.sheet');
  const padding = sides(sheet.getPropertyValue('padding'));
  const border = px(sheet.getPropertyValue('border'));

  return width - padding.left - padding.right - 2 * border;
}

describe('the tool row of a docked light sheet', () => {
  it('holds three whites, colour and more on one row under a finger', () => {
    const tools = 5;
    const touch = 44;
    const gap = px(declarations('.tools').getPropertyValue('gap'));

    expect(tools * touch + (tools - 1) * gap).toBeLessThanOrEqual(
      dockedSheetInside(),
    );
  });
});

describe('the room line of a docked sheet', () => {
  it('holds a temperature, a humidity and one light inside the sheet, with room to spare', () => {
    expect(dockedSheetInside() - roomLineWidth()).toBeGreaterThanOrEqual(
      SPARE_PX,
    );
  });
});
