import { css } from 'lit';

export const tabletStyles = css`
  :host([tablet][portrait]) .floors {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }

  :host([tablet]) .toast {
    min-height: 64px;
    font-size: 15px;
  }

  :host([tablet][portrait]) .stage:not(.sheet-up) .toast {
    bottom: 96px;
  }
`;
