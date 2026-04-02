import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildStableHistoryStorageKey } from '../components/spatial-provider/commandHistoryStorage';
import type { PendingClarificationState } from '../components/spatial-provider/runtimeState';
import { useCommandHistoryRuntime } from '../components/spatial-provider/useCommandHistoryRuntime';

let lastHistoryId = '';

function HistoryHarness({
  initialRoutePath = '/tickets',
  initialTitle = 'Tickets'
}: {
  initialRoutePath?: string;
  initialTitle?: string;
}) {
  const runtime = useCommandHistoryRuntime({
    initialRoutePath,
    initialTitle
  });

  return (
    <div>
      <button
        onClick={() => {
          lastHistoryId = runtime.addCommandHistoryEntry('create ticket', 'text');
        }}
      >
        add
      </button>
      <button
        onClick={() => {
          runtime.appendCommandHistoryTrace(lastHistoryId, 'Planning workflow');
        }}
      >
        trace
      </button>
      <button
        onClick={() => {
          runtime.setPendingClarification({
            question: 'Which ticket?',
            baseCommand: 'create ticket',
            historyEntryId: 'cmd-clarify'
          } satisfies PendingClarificationState);
          runtime.setVoiceClarificationQuestion('Which ticket?');
        }}
      >
        clarify
      </button>
      <button onClick={() => runtime.clearCommandHistory()}>clear</button>
      <div data-testid="history">{JSON.stringify(runtime.commandHistory)}</div>
      <div data-testid="pending">{runtime.pendingClarification?.question || ''}</div>
      <div data-testid="voice">{runtime.voiceClarificationQuestion || ''}</div>
    </div>
  );
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  lastHistoryId = '';
});

describe('useCommandHistoryRuntime', () => {
  it('hydrates from scoped local storage on mount', () => {
    const key = buildStableHistoryStorageKey('/tickets', 'Tickets');
    window.localStorage.setItem(
      key,
      JSON.stringify([
        {
          id: 'cmd-1',
          command: 'open tickets',
          status: 'done',
          inputMethod: 'typed',
          createdAt: 1,
          traces: [{ id: 'trace-1', label: 'Completed', at: 1 }]
        }
      ])
    );

    render(<HistoryHarness />);

    expect(screen.getByTestId('history').textContent).toContain('"command":"open tickets"');
    expect(screen.getByTestId('history').textContent).toContain('"status":"done"');
  });

  it('persists entries and clears clarification state', () => {
    render(<HistoryHarness />);

    fireEvent.click(screen.getByText('add'));
    fireEvent.click(screen.getByText('trace'));
    fireEvent.click(screen.getByText('clarify'));

    expect(screen.getByTestId('history').textContent).toContain('Planning workflow');
    expect(screen.getByTestId('pending').textContent).toBe('Which ticket?');
    expect(screen.getByTestId('voice').textContent).toBe('Which ticket?');

    const key = buildStableHistoryStorageKey('/tickets', 'Tickets');
    expect(window.localStorage.getItem(key)).toContain('create ticket');

    act(() => {
      fireEvent.click(screen.getByText('clear'));
    });

    expect(screen.getByTestId('history').textContent).toBe('[]');
    expect(screen.getByTestId('pending').textContent).toBe('');
    expect(screen.getByTestId('voice').textContent).toBe('');
  });
});
