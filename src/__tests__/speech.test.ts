import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeechController } from '../utils/speech';

describe('createSpeechController', () => {
  let recognitionInstance: any;

  class MockSpeechRecognition {
    continuous = false;
    interimResults = false;
    lang = '';
    onresult?: (event: any) => void;
    onstart?: () => void;
    onend?: () => void;
    onerror?: (event: any) => void;
    start = vi.fn(() => {
      this.onstart?.();
    });
    stop = vi.fn(() => {
      this.onend?.();
    });
    abort = vi.fn();

    constructor() {
      recognitionInstance = this;
    }
  }

  beforeEach(() => {
    recognitionInstance = null;
    (window as typeof window & { webkitSpeechRecognition?: typeof MockSpeechRecognition }).webkitSpeechRecognition =
      MockSpeechRecognition;
  });

  afterEach(() => {
    delete (window as typeof window & { webkitSpeechRecognition?: typeof MockSpeechRecognition })
      .webkitSpeechRecognition;
    vi.restoreAllMocks();
  });

  it('rebuilds transcript updates from the full result list instead of only the changed tail', () => {
    const onTranscript = vi.fn();

    const speech = createSpeechController({
      onTranscript,
      onListening: vi.fn()
    });

    speech.start();
    expect(recognitionInstance.start).toHaveBeenCalledTimes(1);

    recognitionInstance.onresult?.({
      resultIndex: 1,
      results: [
        {
          0: { transcript: 'create a ticket', confidence: 0.61 },
          isFinal: true,
          length: 1
        },
        {
          0: { transcript: 'for pump maintenance', confidence: 0.92 },
          isFinal: false,
          length: 1
        }
      ]
    });

    expect(onTranscript).toHaveBeenCalledWith({
      transcript: 'create a ticket for pump maintenance',
      confidence: 0.92,
      isFinal: false
    });

    speech.restart();
    expect(recognitionInstance.stop).toHaveBeenCalledTimes(1);
    expect(recognitionInstance.start).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh session immediately when restart is called while idle', () => {
    const onListening = vi.fn();
    const speech = createSpeechController({
      onTranscript: vi.fn(),
      onListening
    });

    speech.restart();

    expect(recognitionInstance.start).toHaveBeenCalledTimes(1);
    expect(recognitionInstance.stop).not.toHaveBeenCalled();
    expect(onListening).not.toHaveBeenCalledWith(false);
  });
});
