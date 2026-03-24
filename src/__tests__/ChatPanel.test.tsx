import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '../components/ChatPanel';

describe('ChatPanel', () => {
  it('submits the command on Enter', () => {
    const onSubmit = vi.fn();

    render(
      <ChatPanel
        open
        input="assign to Sarah"
        history={[]}
        canToggleMicrophone
        microphoneEnabled={false}
        onInputChange={() => {}}
        onMicrophoneToggle={() => {}}
        onSubmit={onSubmit}
        onOpenChange={() => {}}
        onClearHistory={() => {}}
        modalitiesStatus={{ voice: true, gaze: false, gesture: false }}
      />
    );

    fireEvent.keyDown(screen.getByLabelText('Exocor command input'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('assign to Sarah');
  });

  it('keeps the send button inactive until text is entered', () => {
    const onSubmit = vi.fn();

    render(
      <ChatPanel
        open
        input=""
        history={[]}
        canToggleMicrophone
        microphoneEnabled={false}
        onInputChange={() => {}}
        onMicrophoneToggle={() => {}}
        onSubmit={onSubmit}
        onOpenChange={() => {}}
        onClearHistory={() => {}}
        modalitiesStatus={{ voice: true, gaze: false, gesture: false }}
      />
    );

    const sendButton = screen.getByLabelText('Send command') as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    fireEvent.click(sendButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('switches the primary action into a stop button while resolving', () => {
    const onStop = vi.fn();

    render(
      <ChatPanel
        open
        input="assign to Sarah"
        history={[]}
        canToggleMicrophone
        microphoneEnabled={false}
        isResolving
        onInputChange={() => {}}
        onMicrophoneToggle={() => {}}
        onSubmit={() => {}}
        onStop={onStop}
        onOpenChange={() => {}}
        onClearHistory={() => {}}
        modalitiesStatus={{ voice: true, gaze: false, gesture: false }}
      />
    );

    fireEvent.click(screen.getByLabelText('Stop command'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('closes on outside click when open', () => {
    const onOpenChange = vi.fn();

    render(
      <ChatPanel
        open
        input=""
        history={[]}
        canToggleMicrophone
        microphoneEnabled={false}
        onInputChange={() => {}}
        onMicrophoneToggle={() => {}}
        onSubmit={() => {}}
        onOpenChange={onOpenChange}
        onClearHistory={() => {}}
        modalitiesStatus={{ voice: true, gaze: false, gesture: false }}
      />
    );

    fireEvent.pointerDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('clears history from header action', () => {
    const onClearHistory = vi.fn();

    render(
      <ChatPanel
        open
        input=""
        history={[
          {
            id: 'cmd-1',
            command: 'create ticket',
            status: 'done',
            inputMethod: 'typed',
            createdAt: Date.now(),
            traces: []
          }
        ]}
        canToggleMicrophone
        microphoneEnabled={false}
        onInputChange={() => {}}
        onMicrophoneToggle={() => {}}
        onSubmit={() => {}}
        onOpenChange={() => {}}
        onClearHistory={onClearHistory}
        modalitiesStatus={{ voice: true, gaze: false, gesture: false }}
      />
    );

    fireEvent.click(screen.getByLabelText('Clear command history'));
    expect(onClearHistory).toHaveBeenCalledTimes(1);
  });

  it('renders history message when present', () => {
    render(
      <ChatPanel
        open
        input=""
        history={[
          {
            id: 'cmd-1',
            command: 'open this',
            status: 'failed',
            inputMethod: 'typed',
            createdAt: Date.now(),
            traces: [],
            message: 'Which ticket should I open?'
          }
        ]}
        canToggleMicrophone
        microphoneEnabled={false}
        onInputChange={() => {}}
        onMicrophoneToggle={() => {}}
        onSubmit={() => {}}
        onOpenChange={() => {}}
        onClearHistory={() => {}}
        modalitiesStatus={{ voice: true, gaze: false, gesture: false }}
      />
    );

    expect(screen.getAllByText('Which ticket should I open?').length).toBeGreaterThan(0);
  });

  it('falls back to typed visual when history input method is unknown', () => {
    render(
      <ChatPanel
        open
        input=""
        history={[
          {
            id: 'cmd-legacy',
            command: 'open this',
            status: 'done',
            inputMethod: 'text' as any,
            createdAt: Date.now(),
            traces: []
          }
        ]}
        canToggleMicrophone
        microphoneEnabled={false}
        onInputChange={() => {}}
        onMicrophoneToggle={() => {}}
        onSubmit={() => {}}
        onOpenChange={() => {}}
        onClearHistory={() => {}}
        modalitiesStatus={{ voice: true, gaze: false, gesture: false }}
      />
    );

    expect(screen.getByText('Typed')).toBeTruthy();
  });

  it('falls back to a safe status style when history status is unknown', () => {
    render(
      <ChatPanel
        open
        input=""
        history={[
          {
            id: 'cmd-legacy-status',
            command: 'legacy status entry',
            status: 'queued' as any,
            inputMethod: 'typed',
            createdAt: Date.now(),
            traces: []
          }
        ]}
        canToggleMicrophone
        microphoneEnabled={false}
        onInputChange={() => {}}
        onMicrophoneToggle={() => {}}
        onSubmit={() => {}}
        onOpenChange={() => {}}
        onClearHistory={() => {}}
        modalitiesStatus={{ voice: true, gaze: false, gesture: false }}
      />
    );

    expect(screen.getByText('legacy status entry')).toBeTruthy();
  });

  it('guards malformed history entries and undefined traces without crashing', () => {
    render(
      <ChatPanel
        open
        input=""
        history={[
          undefined as any,
          {
            id: 'cmd-malformed',
            command: 'legacy malformed entry',
            status: 'queued' as any,
            inputMethod: 'text' as any,
            createdAt: Date.now()
          } as any
        ]}
        canToggleMicrophone
        microphoneEnabled={false}
        onInputChange={() => {}}
        onMicrophoneToggle={() => {}}
        onSubmit={() => {}}
        onOpenChange={() => {}}
        onClearHistory={() => {}}
        modalitiesStatus={{ voice: true, gaze: false, gesture: false }}
      />
    );

    fireEvent.click(screen.getByText('legacy malformed entry'));
    expect(screen.getByText('No trace captured.')).toBeTruthy();
  });

  it('renders fallback UI when chat panel content throws at render time', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const brokenEntry: Record<string, unknown> = {
      id: 'cmd-broken',
      status: 'done',
      inputMethod: 'typed',
      createdAt: Date.now(),
      traces: []
    };

    Object.defineProperty(brokenEntry, 'command', {
      configurable: true,
      get() {
        throw new Error('boom');
      }
    });

    render(
      <ChatPanel
        open
        input=""
        history={[brokenEntry as any]}
        canToggleMicrophone
        microphoneEnabled={false}
        onInputChange={() => {}}
        onMicrophoneToggle={() => {}}
        onSubmit={() => {}}
        onOpenChange={() => {}}
        onClearHistory={() => {}}
        modalitiesStatus={{ voice: true, gaze: false, gesture: false }}
      />
    );

    expect(screen.getByText('Exocor command panel unavailable.')).toBeTruthy();
    consoleErrorSpy.mockRestore();
  });
});
