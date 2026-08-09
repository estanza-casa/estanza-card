declare const __CARD_VERSION__: string;

export const cardVersion: string =
  typeof __CARD_VERSION__ === 'string' ? __CARD_VERSION__ : 'dev';

export function logCardVersion(version: string = cardVersion): void {
  console.info(
    `%c ESTANZA-CARD %c v${version} `,
    'color: #fff; background: #1f2a44; font-weight: 700; border-radius: 3px 0 0 3px',
    'color: #1f2a44; background: #e8ecf4; font-weight: 700; border-radius: 0 3px 3px 0',
  );
}
