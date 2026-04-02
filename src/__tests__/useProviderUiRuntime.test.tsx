import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderUiRuntime } from '../components/spatial-provider/useProviderUiRuntime';

function UiRuntimeHarness() {
  const runtime = useProviderUiRuntime();

  return (
    <div>
      <button onClick={() => runtime.showPreview('Planned action')}>preview</button>
      <button onClick={() => runtime.showToast('done', 'Completed', 400)}>toast</button>
      <button onClick={() => runtime.dismissToast()}>dismiss</button>
      <button onClick={() => runtime.setIsPanelOpen(true)}>open-panel</button>
      <button onClick={() => runtime.setChatInput('search invoices')}>set-input</button>
      <div data-testid="preview">{runtime.resolvedIntentPreview || ''}</div>
      <div data-testid="panel">{String(runtime.isPanelOpen)}</div>
      <div data-testid="input">{runtime.chatInput}</div>
      <div data-testid="toast-open">{String(runtime.toastState.open)}</div>
      <div data-testid="toast-variant">{runtime.toastState.variant}</div>
      <div data-testid="toast-message">{runtime.toastState.message}</div>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('useProviderUiRuntime', () => {
  it('tracks panel state and chat input', () => {
    render(<UiRuntimeHarness />);

    fireEvent.click(screen.getByText('open-panel'));
    fireEvent.click(screen.getByText('set-input'));

    expect(screen.getByTestId('panel').textContent).toBe('true');
    expect(screen.getByTestId('input').textContent).toBe('search invoices');
  });

  it('auto-clears previews and auto-dismisses timed toasts', () => {
    render(<UiRuntimeHarness />);

    fireEvent.click(screen.getByText('preview'));
    fireEvent.click(screen.getByText('toast'));

    expect(screen.getByTestId('preview').textContent).toBe('Planned action');
    expect(screen.getByTestId('toast-open').textContent).toBe('true');
    expect(screen.getByTestId('toast-variant').textContent).toBe('done');
    expect(screen.getByTestId('toast-message').textContent).toBe('Completed');

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId('toast-open').textContent).toBe('false');

    act(() => {
      vi.advanceTimersByTime(2400);
    });
    expect(screen.getByTestId('preview').textContent).toBe('');
  });
});
