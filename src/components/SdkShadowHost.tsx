import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ensureSdkUiStylesInjected, SDK_UI_ATTRIBUTE, SDK_UI_MARKER } from '../core/sdkUi';

interface SdkShadowHostProps {
  children: React.ReactNode;
}

function shouldUseOpenShadowRoot(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /jsdom/i.test(navigator.userAgent || '');
}

export function SdkShadowHost({ children }: SdkShadowHostProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const portalContainerRef = useRef<HTMLDivElement | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    if (!shadowRootRef.current) {
      shadowRootRef.current = host.attachShadow({ mode: shouldUseOpenShadowRoot() ? 'open' : 'closed' });
    }

    const shadowRoot = shadowRootRef.current;
    ensureSdkUiStylesInjected(shadowRoot);

    if (!portalContainerRef.current || !portalContainerRef.current.isConnected) {
      const nextContainer = document.createElement('div');
      nextContainer.setAttribute(SDK_UI_ATTRIBUTE, 'true');
      shadowRoot.appendChild(nextContainer);
      portalContainerRef.current = nextContainer;
    }

    setPortalContainer(portalContainerRef.current);

    return () => {
      const container = portalContainerRef.current;
      if (container?.isConnected) {
        container.remove();
      }
      portalContainerRef.current = null;
    };
  }, []);

  return (
    <>
      <div
        ref={hostRef}
        {...SDK_UI_MARKER}
        data-testid="exocor-sdk-root"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2147483646,
          pointerEvents: 'none',
          background: 'transparent'
        }}
      />
      {portalContainer
        ? createPortal(
            <div
              {...SDK_UI_MARKER}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 2147483646,
                pointerEvents: 'none',
                background: 'transparent'
              }}
            >
              {children}
            </div>,
            portalContainer
          )
        : null}
    </>
  );
}
