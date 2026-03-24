export const SDK_LIGHT_DOM_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap');

  [data-exocor-ui='true'],
  [data-exocor-ui='true'] * {
    box-sizing: border-box;
  }

  [data-exocor-ui='true'] {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 14px !important;
    font-style: normal !important;
    font-weight: 400 !important;
    line-height: 20px !important;
    letter-spacing: normal !important;
    text-transform: none !important;
    text-size-adjust: none;
    -webkit-text-size-adjust: none;
  }

  [data-exocor-ui='true'] button,
  [data-exocor-ui='true'] input,
  [data-exocor-ui='true'] textarea,
  [data-exocor-ui='true'] select {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 14px !important;
    font-style: normal !important;
    font-weight: 400 !important;
    line-height: 18px !important;
    letter-spacing: normal !important;
    text-transform: none !important;
  }

  [data-exocor-ui='true'] button {
    appearance: none;
    -webkit-appearance: none;
  }

  [data-exocor-ui='true'] [data-exocor-text='chat-input'],
  [data-exocor-ui='true'] [data-exocor-text='chat-input']::placeholder {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 14px !important;
    font-style: normal !important;
    font-weight: 300 !important;
    line-height: normal !important;
    letter-spacing: -0.14px !important;
  }

  [data-exocor-ui='true'] [data-exocor-text='ui-body-sm'] {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 12px !important;
    font-style: normal !important;
    font-weight: 400 !important;
    line-height: 140% !important;
    letter-spacing: 0.06px !important;
  }

  [data-exocor-ui='true'] [data-exocor-text='caption-bold'],
  [data-exocor-ui='true'] [data-exocor-text='caption-bold'] * {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 12px !important;
    font-style: normal !important;
    font-weight: 500 !important;
    line-height: normal !important;
    letter-spacing: 0.06px !important;
  }

  [data-exocor-ui='true'] [data-exocor-text='intent-title'] {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 13px !important;
    font-style: normal !important;
    font-weight: 400 !important;
    line-height: normal !important;
    letter-spacing: -0.13px !important;
  }

  [data-exocor-ui='true'] [data-exocor-text='floating-clarification'] {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 20px !important;
    font-style: normal !important;
    font-weight: 400 !important;
    line-height: 140% !important;
    letter-spacing: -0.2px !important;
  }

  [data-exocor-ui='true'] [data-exocor-text='toast'] {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 14px !important;
    font-style: normal !important;
    font-weight: 400 !important;
    line-height: normal !important;
    letter-spacing: -0.14px !important;
  }

  [data-exocor-ui='true'] [data-exocor-text='intent-detail'],
  [data-exocor-ui='true'] [data-exocor-text='intent-detail'] * {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 12px !important;
    font-style: normal !important;
    font-weight: 300 !important;
    line-height: 140% !important;
    letter-spacing: 0.06px !important;
  }

  [data-exocor-ui='true'] [data-exocor-text='learning-overlay'],
  [data-exocor-ui='true'] [data-exocor-text='learning-overlay'] * {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    font-size: 24px !important;
    font-style: normal !important;
    font-weight: 500 !important;
    line-height: 140% !important;
    letter-spacing: -0.36px !important;
  }

  [data-exocor-ui='true'] [data-exocor-text] {
    text-transform: none !important;
  }

  [data-exocor-ui='true'] [data-exocor-chat-input='true']::placeholder {
    color: var(--exocor-chat-input-placeholder, #a8a8a8);
    opacity: 1;
    letter-spacing: -0.14px;
  }

  [data-exocor-ui='true'] ::selection {
    background: rgba(36, 161, 72, 0.18);
  }

  [data-exocor-ui='true'] *:focus-visible {
    outline: none;
  }

  [data-exocor-ui='true'] [data-exocor-scrollable='true'] {
    scrollbar-width: thin;
    scrollbar-color: rgba(141, 141, 141, 0.45) transparent;
  }

  [data-exocor-ui='true'] [data-exocor-scrollable='true']::-webkit-scrollbar {
    width: 6px;
  }

  [data-exocor-ui='true'] [data-exocor-scrollable='true']::-webkit-scrollbar-track {
    background: transparent;
  }

  [data-exocor-ui='true'] [data-exocor-scrollable='true']::-webkit-scrollbar-thumb {
    background: rgba(141, 141, 141, 0.45);
    border-radius: 999px;
  }

  @keyframes exocor-status-ring-pulse {
    0% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0.95;
    }
    100% {
      transform: translate(-50%, -50%) scale(2);
      opacity: 0.15;
    }
  }

  @keyframes exocor-status-dot-pulse {
    0%,
    100% {
      transform: translate(-50%, -50%) scale(1);
    }
    50% {
      transform: translate(-50%, -50%) scale(0.96);
    }
  }

  @keyframes exocor-discovery-pulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.55;
    }
    50% {
      transform: scale(1.22);
      opacity: 1;
    }
  }

  @keyframes exocor-discovery-progress {
    0% {
      transform: translateX(-120%);
      opacity: 0;
    }
    45% {
      opacity: 1;
    }
    100% {
      transform: translateX(120%);
      opacity: 0;
    }
  }

  @keyframes exocor-loading-dot-wave {
    0%,
    80%,
    100% {
      opacity: 0.42;
      transform: translateY(0);
    }
    40% {
      opacity: 1;
      transform: translateY(-1px);
    }
  }

  @keyframes exocor-learning-dot-1 {
    0%,
    24.99% {
      opacity: 0;
    }
    25%,
    100% {
      opacity: 1;
    }
  }

  @keyframes exocor-learning-dot-2 {
    0%,
    49.99% {
      opacity: 0;
    }
    50%,
    100% {
      opacity: 1;
    }
  }

  @keyframes exocor-learning-dot-3 {
    0%,
    74.99% {
      opacity: 0;
    }
    75%,
    100% {
      opacity: 1;
    }
  }
`;
