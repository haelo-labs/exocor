export interface TranscriptUpdate {
  transcript: string;
  confidence: number;
  isFinal: boolean;
}

export interface SpeechControllerOptions {
  continuous?: boolean;
  lang?: string;
  onTranscript: (update: TranscriptUpdate) => void;
  onListening: (isListening: boolean) => void;
  onError?: (message: string) => void;
}

export interface SpeechController {
  isSupported: boolean;
  start: () => void;
  stop: () => void;
  restart: () => void;
  destroy: () => void;
}

type SpeechRecognitionCtor = new () => any;

/** Creates a speech recognition controller backed by the browser Web Speech API. */
export function createSpeechController(options: SpeechControllerOptions): SpeechController {
  const ctor =
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor })
      .SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;

  if (!ctor) {
    return {
      isSupported: false,
      start: () => {},
      stop: () => {},
      restart: () => {},
      destroy: () => {}
    };
  }

  const recognition: any = new ctor();
  let keepRunning = false;
  let isListening = false;
  let isStarting = false;
  let isDestroyed = false;
  let restartPending = false;

  const safeStart = () => {
    if (isDestroyed || isListening || isStarting) {
      return;
    }

    isStarting = true;

    try {
      recognition.start();
    } catch {
      isStarting = false;
    }
  };

  recognition.continuous = options.continuous ?? true;
  recognition.interimResults = true;
  recognition.lang = options.lang ?? 'en-US';

  recognition.onresult = (event: any) => {
    let transcript = '';
    let confidence = 0;

    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const alternative = result[0];
      transcript += `${alternative.transcript} `;
      confidence = Math.max(confidence, alternative.confidence || 0);
    }

    const latest = event.results[event.results.length - 1];

    options.onTranscript({
      transcript: transcript.trim(),
      confidence,
      isFinal: latest?.isFinal ?? false
    });
  };

  recognition.onstart = () => {
    isStarting = false;
    isListening = true;
    options.onListening(true);
  };

  recognition.onend = () => {
    isStarting = false;
    isListening = false;
    options.onListening(false);
    if (isDestroyed) {
      return;
    }

    if (restartPending) {
      restartPending = false;
      keepRunning = true;
      safeStart();
      return;
    }

    if (keepRunning) {
      safeStart();
    }
  };

  recognition.onerror = (event: any) => {
    options.onError?.(event.error);
  };

  return {
    isSupported: true,
    start: () => {
      keepRunning = true;
      restartPending = false;
      safeStart();
    },
    stop: () => {
      keepRunning = false;
      restartPending = false;
      if (isListening || isStarting) {
        recognition.stop();
      }
    },
    restart: () => {
      if (isDestroyed) {
        return;
      }

      keepRunning = true;
      if (isListening || isStarting) {
        restartPending = true;
        recognition.stop();
        return;
      }

      safeStart();
    },
    destroy: () => {
      isDestroyed = true;
      keepRunning = false;
      restartPending = false;
      if (isListening || isStarting) {
        recognition.abort();
      }
    }
  };
}
