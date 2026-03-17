import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SDK_UI_MARKER } from '../core/sdkUi';
import { resolveSdkTheme, type SdkThemeMode } from '../core/sdkTheme';
import {
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  LoadingIcon,
  TrashIcon
} from './sdkIcons';

export type CommandHistoryStatus = 'planning' | 'executing' | 'done' | 'failed' | 'clarification';
export type CommandInputMethod = 'voice' | 'typed' | 'gaze';

export interface CommandTraceItem {
  id: string;
  label: string;
  at: number;
}

export interface CommandHistoryItem {
  id: string;
  command: string;
  status: CommandHistoryStatus;
  inputMethod: CommandInputMethod;
  createdAt: number;
  traces: CommandTraceItem[];
  message?: string;
}

interface ChatPanelProps {
  open: boolean;
  input: string;
  history: CommandHistoryItem[];
  canToggleMicrophone: boolean;
  microphoneEnabled: boolean;
  onInputChange: (value: string) => void;
  onMicrophoneToggle: () => void;
  onSubmit: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onClearHistory: () => void;
  pendingClarificationQuestion?: string | null;
  modalitiesStatus: {
    voice: boolean;
    gaze: boolean;
    gesture: boolean;
  };
  themeMode?: SdkThemeMode;
}

const INPUT_METHOD_LABELS: Record<CommandInputMethod, string> = {
  voice: 'Voice',
  typed: 'Typed',
  gaze: 'Gaze'
};

const HIDDEN_CONTROL_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0
};

interface ChatPanelErrorBoundaryState {
  hasError: boolean;
}

class ChatPanelErrorBoundary extends React.Component<{ children: React.ReactNode }, ChatPanelErrorBoundaryState> {
  override state: ChatPanelErrorBoundaryState = {
    hasError: false
  };

  static getDerivedStateFromError(): ChatPanelErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(): void {
    // Render fallback only.
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          {...SDK_UI_MARKER}
          style={{
            position: 'fixed',
            right: 20,
            bottom: 88,
            width: 'min(392px, calc(100vw - 24px))',
            zIndex: 2147483646,
            pointerEvents: 'none'
          }}
        >
          <div
            {...SDK_UI_MARKER}
            style={{
              pointerEvents: 'auto',
              borderRadius: 12,
              border: '1px solid rgba(100, 118, 146, 0.48)',
              background: 'rgba(12, 19, 30, 0.95)',
              color: '#d9eeff',
              padding: '8px 12px',
              fontSize: 12,
              lineHeight: '16px'
            }}
          >
            Exocor command panel unavailable.
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function formatRelativeTimestamp(timestamp: number, now: number): string {
  const diffSeconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (diffSeconds < 10) {
    return 'just now';
  }
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function renderStatusIcon(status: Exclude<CommandHistoryStatus, 'clarification'>, color: string): JSX.Element {
  if (status === 'done') {
    return <CircleCheckIcon size={12} color={color} />;
  }
  if (status === 'failed') {
    return <CircleXIcon size={12} color={color} />;
  }
  return <LoadingIcon size={12} color={color} animated />;
}

function fallbackStatusMessage(status: Exclude<CommandHistoryStatus, 'clarification'>): string {
  if (status === 'planning') {
    return 'Planning workflow';
  }
  if (status === 'executing') {
    return 'Executing';
  }
  if (status === 'done') {
    return 'Completed';
  }
  return 'Request failed';
}

function ChatPanelContent({
  open,
  input,
  history,
  canToggleMicrophone,
  microphoneEnabled,
  onInputChange,
  onMicrophoneToggle,
  onSubmit,
  onOpenChange,
  onClearHistory,
  pendingClarificationQuestion = null,
  modalitiesStatus,
  themeMode = 'dark'
}: ChatPanelProps): JSX.Element {
  const theme = resolveSdkTheme(themeMode);
  const safeHistory = useMemo(() => (Array.isArray(history) ? history : []), [history]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pointerDownInsideRef = useRef(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [isSendHovered, setIsSendHovered] = useState(false);
  const [isSendPressed, setIsSendPressed] = useState(false);
  const [isClearHovered, setIsClearHovered] = useState(false);
  const [isClearPressed, setIsClearPressed] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (): void => {
      const wasInsidePanel = pointerDownInsideRef.current;
      pointerDownInsideRef.current = false;
      if (!wasInsidePanel) {
        onOpenChange(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const interval = window.setInterval(() => {
      setClockNow(Date.now());
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [open]);

  useEffect(() => {
    setExpandedItems((previous) => {
      const next: Record<string, boolean> = {};
      for (const item of safeHistory) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const itemId = typeof item.id === 'string' ? item.id : '';
        if (itemId && previous[itemId]) {
          next[itemId] = true;
        }
      }
      return next;
    });
  }, [safeHistory]);

  const visibleHistory = useMemo(
    () =>
      safeHistory
        .filter((item): item is CommandHistoryItem => Boolean(item && typeof item === 'object'))
        .filter((item) => item.status !== 'clarification')
        .slice()
        .sort((left, right) => {
          const timeDiff = left.createdAt - right.createdAt;
          if (timeDiff !== 0) {
            return timeDiff;
          }
          return left.id.localeCompare(right.id);
        }),
    [safeHistory]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) {
      return;
    }

    window.requestAnimationFrame(() => {
      scrollArea.scrollTop = scrollArea.scrollHeight;
    });
  }, [open, visibleHistory.length, pendingClarificationQuestion]);

  const canSubmit = input.trim().length > 0;

  useEffect(() => {
    if (canSubmit) {
      return;
    }

    setIsSendHovered(false);
    setIsSendPressed(false);
  }, [canSubmit]);

  useEffect(() => {
    if (visibleHistory.length > 0) {
      return;
    }

    setIsClearHovered(false);
    setIsClearPressed(false);
  }, [visibleHistory.length]);

  const handleSubmit = (): void => {
    if (!canSubmit) {
      return;
    }

    onSubmit(input);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const sendButtonBackground = !canSubmit
    ? theme.sendButtonSurface
    : isSendPressed
      ? theme.sendButtonPressedSurface
      : isSendHovered
        ? theme.sendButtonHoverSurface
        : theme.sendButtonSurface;
  const sendButtonIconColor = canSubmit ? theme.sendButtonActiveIcon : theme.sendButtonInactiveIcon;
  const clearButtonBackground = isClearPressed
    ? theme.clearButtonPressedSurface
    : isClearHovered
      ? theme.clearButtonHoverSurface
      : 'transparent';
  const clearButtonIconColor = isClearHovered || isClearPressed ? theme.clearButtonActiveIcon : theme.clearButtonDefaultIcon;

  const modalityEntries = useMemo(
    () => [
      { key: 'gaze', label: 'Gaze', enabled: modalitiesStatus.gaze, interactive: false },
      { key: 'gesture', label: 'Gesture', enabled: modalitiesStatus.gesture, interactive: false },
      {
        key: 'voice',
        label: 'Voice',
        enabled: modalitiesStatus.voice,
        interactive: canToggleMicrophone
      }
    ],
    [canToggleMicrophone, modalitiesStatus.gaze, modalitiesStatus.gesture, modalitiesStatus.voice]
  );

  return (
    <div
      {...SDK_UI_MARKER}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 80,
        width: 'min(400px, calc(100vw - 32px))',
        zIndex: 2147483646,
        pointerEvents: 'none'
      }}
    >
      <div
        ref={panelRef}
        {...SDK_UI_MARKER}
        onPointerDownCapture={() => {
          pointerDownInsideRef.current = true;
        }}
        style={{
          pointerEvents: open ? 'auto' : 'none',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 24,
          border: `1px solid ${theme.panelBorder}`,
          background: theme.panelSurface,
          color: theme.textPrimary,
          boxShadow: theme.panelShadow,
          overflow: 'hidden',
          maxHeight: 'min(441px, calc(100vh - 120px))',
          transform: open ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.985)',
          opacity: open ? 1 : 0,
          transition: 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease'
        }}
      >
        <button {...SDK_UI_MARKER} type="button" aria-label="Close command panel" onClick={() => onOpenChange(false)} style={HIDDEN_CONTROL_STYLE} />
        <div
          {...SDK_UI_MARKER}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: 16
          }}
        >
          <div {...SDK_UI_MARKER} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {modalityEntries.map((modality) => {
              const sharedStyle: React.CSSProperties = {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                minHeight: 24,
                padding: '4px 8px',
                borderRadius: 8,
                border: 'none',
                background: modality.enabled ? theme.toggleActiveBackground : theme.toggleInactiveBackground,
                color: modality.enabled ? theme.toggleActiveText : theme.toggleInactiveText,
                fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                fontSize: 12,
                lineHeight: '140%',
                fontWeight: 400,
                letterSpacing: '-0.12px'
              };

              const dotStyle: React.CSSProperties = {
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: modality.enabled
                  ? themeMode === 'light'
                    ? '#42be65'
                    : '#24a148'
                  : theme.textMuted
              };

              if (modality.interactive) {
                return (
                  <button
                    key={modality.key}
                    {...SDK_UI_MARKER}
                    data-exocor-text="ui-body-sm"
                    type="button"
                    onClick={onMicrophoneToggle}
                    aria-label={microphoneEnabled ? 'Turn microphone off' : 'Turn microphone on'}
                    style={{
                      ...sharedStyle,
                      cursor: 'pointer'
                    }}
                  >
                    <span {...SDK_UI_MARKER} aria-hidden="true" style={dotStyle} />
                    {modality.label}
                  </button>
                );
              }

              return (
                <span key={modality.key} {...SDK_UI_MARKER} data-exocor-text="ui-body-sm" style={sharedStyle}>
                  <span {...SDK_UI_MARKER} aria-hidden="true" style={dotStyle} />
                  {modality.label}
                </span>
              );
            })}
          </div>

          {visibleHistory.length ? (
            <button
              {...SDK_UI_MARKER}
              type="button"
              onClick={() => {
                onClearHistory();
                setExpandedItems({});
              }}
              aria-label="Clear command history"
              onPointerEnter={() => {
                setIsClearHovered(true);
              }}
              onPointerLeave={() => {
                setIsClearHovered(false);
                setIsClearPressed(false);
              }}
              onPointerDown={() => {
                setIsClearPressed(true);
              }}
              onPointerUp={() => {
                setIsClearPressed(false);
              }}
              onPointerCancel={() => {
                setIsClearPressed(false);
                setIsClearHovered(false);
              }}
              onBlur={() => {
                setIsClearPressed(false);
              }}
              style={{
                width: 24,
                height: 24,
                flex: '0 0 24px',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                borderRadius: 8,
                background: clearButtonBackground,
                color: clearButtonIconColor,
                cursor: 'pointer'
              }}
            >
              <TrashIcon size={16} color={clearButtonIconColor} style={{ display: 'block', flexShrink: 0 }} />
            </button>
          ) : (
            <span {...SDK_UI_MARKER} />
          )}
        </div>

        <div
          {...SDK_UI_MARKER}
          data-exocor-scrollable="true"
          ref={scrollAreaRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '0 16px'
          }}
        >
          {visibleHistory.length ? (
            <div
              {...SDK_UI_MARKER}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: pendingClarificationQuestion ? 16 : 8,
                paddingBottom: 16
              }}
            >
              <div {...SDK_UI_MARKER} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleHistory.map((item, index) => {
              const safeItem = item && typeof item === 'object' ? (item as Partial<CommandHistoryItem>) : {};
              const itemId = typeof safeItem.id === 'string' && safeItem.id ? safeItem.id : `history-${index}`;
              const itemStatus = typeof safeItem.status === 'string' ? safeItem.status : 'executing';
              const normalizedStatus = (['planning', 'executing', 'done', 'failed'].includes(itemStatus)
                ? itemStatus
                : itemStatus === 'clarification'
                  ? 'clarification'
                  : 'executing') as CommandHistoryStatus;
              const itemInputMethod = typeof safeItem.inputMethod === 'string' ? safeItem.inputMethod : 'typed';
              const itemCreatedAt = typeof safeItem.createdAt === 'number' ? safeItem.createdAt : clockNow;
              const itemCommand = typeof safeItem.command === 'string' ? safeItem.command : '';
              const itemMessage = typeof safeItem.message === 'string' ? safeItem.message : '';
              const safeTraces = Array.isArray(safeItem.traces) ? safeItem.traces : [];
              const isExpanded = Boolean(expandedItems[itemId]);
              const methodLabel = INPUT_METHOD_LABELS[itemInputMethod as CommandInputMethod] ?? INPUT_METHOD_LABELS.typed;
              const status = normalizedStatus as Exclude<CommandHistoryStatus, 'clarification'>;
              const statusMessage = itemMessage || fallbackStatusMessage(status);

              return (
                <div
                  key={itemId}
                  {...SDK_UI_MARKER}
                  style={{
                    borderRadius: 12,
                    background: theme.panelInsetSurface,
                    overflow: 'hidden'
                  }}
                >
                  <button
                    {...SDK_UI_MARKER}
                    type="button"
                    onClick={() =>
                      setExpandedItems((previous) => ({
                        ...previous,
                        [itemId]: !previous[itemId]
                      }))
                    }
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: 12,
                      padding: '12px 8px 12px 12px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'inherit'
                    }}
                  >
                    <div
                      {...SDK_UI_MARKER}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8
                      }}
                    >
                      <div {...SDK_UI_MARKER} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div
                          {...SDK_UI_MARKER}
                          data-exocor-text="intent-title"
                          style={{
                            color: theme.textPrimary,
                            fontSize: 13,
                            lineHeight: 'normal',
                            fontWeight: 400,
                            letterSpacing: '-0.13px'
                          }}
                        >
                          {itemCommand}
                        </div>
                        <div
                          {...SDK_UI_MARKER}
                          data-exocor-text="intent-detail"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            color: theme.textMuted,
                            fontSize: 12,
                            lineHeight: '140%',
                            letterSpacing: '-0.12px'
                          }}
                        >
                          <span {...SDK_UI_MARKER}>{methodLabel}</span>
                          <span {...SDK_UI_MARKER} aria-hidden="true">
                            •
                          </span>
                          <span {...SDK_UI_MARKER}>{formatRelativeTimestamp(itemCreatedAt, clockNow)}</span>
                        </div>
                      </div>

                      <div
                        {...SDK_UI_MARKER}
                        data-exocor-text="intent-detail"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            color: theme.statusLineColor,
                            fontSize: 12,
                            lineHeight: '140%',
                            fontWeight: 400,
                            letterSpacing: '-0.12px'
                          }}
                      >
                        {renderStatusIcon(status, theme.statusLineColor)}
                        <span {...SDK_UI_MARKER}>{statusMessage}</span>
                      </div>
                    </div>

                    {isExpanded ? (
                      <ChevronDownIcon size={16} color={theme.iconMuted} />
                    ) : (
                      <ChevronRightIcon size={16} color={theme.iconMuted} />
                    )}
                  </button>

                  {isExpanded ? (
                    <div {...SDK_UI_MARKER} style={{ padding: '0 4px 4px' }}>
                      <div
                        {...SDK_UI_MARKER}
                        data-exocor-text="intent-detail"
                        style={{
                          borderRadius: 8,
                          background: theme.panelNestedSurface,
                          padding: '8px 8px 8px 24px',
                          color: theme.textSubtle,
                          fontSize: 12,
                          lineHeight: '140%',
                          fontWeight: 400,
                          letterSpacing: '-0.12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8
                        }}
                      >
                        {safeTraces.length ? (
                          safeTraces.map((trace, traceIndex) => {
                            const safeTrace = trace && typeof trace === 'object' ? (trace as Partial<CommandTraceItem>) : {};
                            const traceId =
                              typeof safeTrace.id === 'string' && safeTrace.id
                                ? safeTrace.id
                                : `${itemId}-trace-${traceIndex}`;
                            const traceLabel = typeof safeTrace.label === 'string' ? safeTrace.label : 'Trace event';

                            return (
                              <div key={traceId} {...SDK_UI_MARKER}>
                                {traceLabel}
                              </div>
                            );
                          })
                        ) : (
                          <div {...SDK_UI_MARKER}>No trace captured.</div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
              </div>

              {pendingClarificationQuestion ? (
                <div
                  {...SDK_UI_MARKER}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: '0 8px'
                  }}
                >
                  <div
                    {...SDK_UI_MARKER}
                    data-exocor-text="intent-detail"
                    style={{
                      color: theme.textSecondary,
                      fontSize: 12,
                      lineHeight: '140%',
                      fontWeight: 400,
                      letterSpacing: '-0.12px'
                    }}
                  >
                    Clarification needed
                  </div>
                  <div
                    {...SDK_UI_MARKER}
                    data-exocor-text="chat-input"
                    style={{
                      color: theme.textPrimary,
                      fontSize: 14,
                      lineHeight: 'normal',
                      fontWeight: 300,
                      letterSpacing: '-0.14px'
                    }}
                  >
                    {pendingClarificationQuestion}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            pendingClarificationQuestion ? (
              <div
                {...SDK_UI_MARKER}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: '0 8px 16px'
                }}
              >
                <div
                  {...SDK_UI_MARKER}
                  data-exocor-text="intent-detail"
                  style={{
                    color: theme.textSecondary,
                    fontSize: 12,
                    lineHeight: '140%',
                    fontWeight: 400,
                    letterSpacing: '-0.12px'
                  }}
                >
                  Clarification needed
                </div>
                <div
                  {...SDK_UI_MARKER}
                  data-exocor-text="chat-input"
                  style={{
                    color: theme.textPrimary,
                    fontSize: 14,
                    lineHeight: 'normal',
                    fontWeight: 300,
                    letterSpacing: '-0.14px'
                  }}
                >
                  {pendingClarificationQuestion}
                </div>
              </div>
            ) : (
              <div
                {...SDK_UI_MARKER}
                data-exocor-text="ui-body-sm"
                style={{
                  borderRadius: 12,
                  background: theme.panelInsetSurface,
                  padding: 16,
                  color: theme.textMuted,
                  textAlign: 'center',
                  fontSize: 12,
                  lineHeight: '140%',
                  fontWeight: 400,
                  letterSpacing: '-0.12px',
                  marginBottom: 16
                }}
              >
                Your history will appear here after your first intention
              </div>
            )
          )}
        </div>

        <div {...SDK_UI_MARKER} style={{ padding: 16, paddingTop: 0 }}>
          <div
            {...SDK_UI_MARKER}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              width: '100%'
            }}
          >
            <div
              {...SDK_UI_MARKER}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                minHeight: 34,
                borderRadius: '8px 0 0 8px',
                background: theme.inputSurface,
                padding: '8px 12px'
              }}
            >
              <input
                ref={inputRef}
                {...SDK_UI_MARKER}
                data-exocor-chat-input="true"
                data-exocor-text="chat-input"
                aria-label="Exocor command input"
                value={input}
                placeholder="Type your intent..."
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSubmit();
                  }
                }}
                style={{
                  ['--exocor-chat-input-placeholder' as string]: theme.inputPlaceholder,
                  width: '100%',
                  minWidth: 0,
                  height: 18,
                  border: 'none',
                  background: 'transparent',
                  color: theme.textPrimary,
                  padding: 0,
                  outline: 'none',
                  caretColor: theme.textPrimary,
                  fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  fontSize: 14,
                  lineHeight: 'normal',
                  letterSpacing: '-0.14px'
                }}
              />
            </div>

            <button
              {...SDK_UI_MARKER}
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              aria-label="Send command"
              onPointerEnter={() => {
                if (!canSubmit) {
                  return;
                }
                setIsSendHovered(true);
              }}
              onPointerLeave={() => {
                setIsSendHovered(false);
                setIsSendPressed(false);
              }}
              onPointerDown={() => {
                if (!canSubmit) {
                  return;
                }
                setIsSendPressed(true);
              }}
              onPointerUp={() => {
                setIsSendPressed(false);
              }}
              onPointerCancel={() => {
                setIsSendPressed(false);
                setIsSendHovered(false);
              }}
              onBlur={() => {
                setIsSendPressed(false);
              }}
              style={{
                width: 34,
                height: 34,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '0 8px 8px 0',
                border: 'none',
                background: sendButtonBackground,
                color: sendButtonIconColor,
                cursor: canSubmit ? 'pointer' : 'default',
                flex: '0 0 auto',
                padding: 0,
                transition: 'background-color 120ms ease'
              }}
            >
              <ArrowUpIcon size={16} color={sendButtonIconColor} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPanel(props: ChatPanelProps): JSX.Element {
  return (
    <ChatPanelErrorBoundary>
      <ChatPanelContent {...props} />
    </ChatPanelErrorBoundary>
  );
}
