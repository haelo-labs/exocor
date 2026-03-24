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
  StopIcon,
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
  onStop?: () => void;
  isResolving?: boolean;
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

const GEIST_FONT = '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const PANEL_WIDTH = 'min(400px, calc(100vw - 48px))';

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
            right: 24,
            bottom: 80,
            width: PANEL_WIDTH,
            zIndex: 2147483646,
            pointerEvents: 'none'
          }}
        >
          <div
            {...SDK_UI_MARKER}
            style={{
              pointerEvents: 'auto',
              borderRadius: 16,
              border: '0.5px solid rgba(255, 255, 255, 0.1)',
              background: '#262626',
              color: '#f4f4f4',
              padding: '12px 16px',
              fontFamily: GEIST_FONT,
              fontSize: 12,
              lineHeight: '140%',
              fontWeight: 500,
              letterSpacing: '0.06px',
              boxShadow: '-2px 4px 24px rgba(0, 0, 0, 0.35)'
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
    return <CircleCheckIcon size={14} color={color} />;
  }
  if (status === 'failed') {
    return <CircleXIcon size={14} color={color} />;
  }
  return <LoadingIcon size={14} color={color} animated />;
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
  onStop = () => {},
  isResolving = false,
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
  const [isVoiceToggleHovered, setIsVoiceToggleHovered] = useState(false);

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

  const handlePrimaryAction = (): void => {
    if (isResolving) {
      onStop();
      return;
    }
    handleSubmit();
  };

  const sendButtonBackground = isSendPressed
    ? theme.sendButtonPressedSurface
    : isSendHovered
      ? theme.sendButtonHoverSurface
      : theme.sendButtonSurface;
  const sendButtonIconColor = isResolving
    ? theme.sendButtonActiveIcon
    : canSubmit
      ? theme.sendButtonActiveIcon
      : theme.sendButtonInactiveIcon;
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

  const detailHorizontalPadding = theme.mode === 'light' ? 12 : 8;
  const traceLineColor = theme.mode === 'light' ? '#c6c6c6' : '#6f6f6f';
  const traceDotColor = theme.mode === 'light' ? '#a8a8a8' : '#c6c6c6';
  const traceTextColor = theme.mode === 'light' ? '#262626' : theme.textPrimary;
  const historyGap = theme.mode === 'light' ? 16 : 12;
  const intentSuccessIconColor = theme.mode === 'light' ? '#24A148' : '#42BE65';
  const intentFailedIconColor = theme.mode === 'light' ? '#DA1E28' : '#FA4D56';

  return (
    <div
      {...SDK_UI_MARKER}
      style={{
        position: 'fixed',
        right: 24,
        bottom: 80,
        width: PANEL_WIDTH,
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
          borderRadius: 32,
          border: `0.5px solid ${theme.panelBorder}`,
          background: theme.panelSurface,
          color: theme.textPrimary,
          boxShadow: theme.panelShadow,
          overflow: 'hidden',
          maxHeight: 'min(520px, calc(100vh - 120px))',
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
              const isHovered = modality.key === 'voice' && isVoiceToggleHovered;
              const isActive = modality.enabled;
              const background = isActive
                ? theme.mode === 'light'
                  ? isHovered
                    ? 'rgba(36, 161, 72, 0.4)'
                    : theme.toggleActiveBackground
                  : isHovered
                    ? '#044317'
                    : theme.toggleActiveBackground
                : theme.mode === 'light'
                  ? isHovered
                    ? '#e0e0e0'
                    : theme.toggleInactiveBackground
                  : isHovered
                    ? '#262626'
                    : theme.toggleInactiveBackground;
              const borderColor = isActive
                ? theme.mode === 'light'
                  ? 'rgba(36, 161, 72, 0.08)'
                  : isHovered
                    ? '#0e6027'
                    : '#198038'
                : theme.panelBorder;
              const textColor = isActive ? theme.toggleActiveText : theme.toggleInactiveText;
              const dotColor = isActive ? theme.status.listening.dot : theme.status.idle.dot;
              const pillStyle: React.CSSProperties = {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                minHeight: 24,
                padding: '4px 8px 4px 7px',
                borderRadius: 999,
                border: `0.5px solid ${borderColor}`,
                background,
                color: textColor
              };

              const content = (
                <>
                  <span
                    {...SDK_UI_MARKER}
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: dotColor,
                      flexShrink: 0
                    }}
                  />
                  <span {...SDK_UI_MARKER}>{modality.label}</span>
                </>
              );

              if (modality.interactive) {
                return (
                  <button
                    key={modality.key}
                    {...SDK_UI_MARKER}
                    data-exocor-text="caption-bold"
                    type="button"
                    onClick={onMicrophoneToggle}
                    aria-label={microphoneEnabled ? 'Turn microphone off' : 'Turn microphone on'}
                    onPointerEnter={() => setIsVoiceToggleHovered(true)}
                    onPointerLeave={() => setIsVoiceToggleHovered(false)}
                    style={{
                      ...pillStyle,
                      cursor: 'pointer'
                    }}
                  >
                    {content}
                  </button>
                );
              }

              return (
                <span key={modality.key} {...SDK_UI_MARKER} data-exocor-text="caption-bold" style={pillStyle}>
                  {content}
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
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                borderRadius: 10,
                background: clearButtonBackground,
                color: clearButtonIconColor,
                cursor: 'pointer',
                padding: 0
              }}
            >
              <TrashIcon size={16} color={clearButtonIconColor} style={{ display: 'block', flexShrink: 0 }} />
            </button>
          ) : (
            <span {...SDK_UI_MARKER} style={{ width: 24, height: 24, flex: '0 0 24px' }} />
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
                  const methodLabel =
                    INPUT_METHOD_LABELS[itemInputMethod as CommandInputMethod] ?? INPUT_METHOD_LABELS.typed;
                  const status = normalizedStatus as Exclude<CommandHistoryStatus, 'clarification'>;
                  const statusMessage = itemMessage || fallbackStatusMessage(status);
                  const resultIconColor =
                    status === 'done'
                      ? intentSuccessIconColor
                      : status === 'failed'
                        ? intentFailedIconColor
                        : theme.statusLineColor;

                  return (
                    <div
                      key={itemId}
                      {...SDK_UI_MARKER}
                      style={{
                        borderRadius: 16,
                        background: theme.panelInsetSurface,
                        border: `0.5px solid ${theme.panelBorder}`,
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
                          gap: historyGap,
                          padding: 12,
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
                                fontFamily: GEIST_FONT,
                                fontSize: 14,
                                lineHeight: 'normal',
                                fontWeight: 400,
                                letterSpacing: '-0.07px'
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
                                color: theme.textSecondary
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
                              gap: 8,
                              color: theme.statusLineColor
                            }}
                          >
                            {renderStatusIcon(status, resultIconColor)}
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
                        <div
                          {...SDK_UI_MARKER}
                          style={{
                            borderTop: `0.5px solid ${theme.panelBorder}`,
                            background: theme.panelNestedSurface,
                            padding: 12,
                            display: 'flex',
                            flexDirection: 'column'
                          }}
                        >
                          {safeTraces.length ? (
                            safeTraces.map((trace, traceIndex) => {
                              const safeTrace =
                                trace && typeof trace === 'object' ? (trace as Partial<CommandTraceItem>) : {};
                              const traceId =
                                typeof safeTrace.id === 'string' && safeTrace.id
                                  ? safeTrace.id
                                  : `${itemId}-trace-${traceIndex}`;
                              const traceLabel =
                                typeof safeTrace.label === 'string' ? safeTrace.label : 'Trace event';
                              const isLastTrace = traceIndex === safeTraces.length - 1;

                              return (
                                <div
                                  key={traceId}
                                  {...SDK_UI_MARKER}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 8,
                                    width: '100%'
                                  }}
                                >
                                  <div
                                    {...SDK_UI_MARKER}
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        flex: '0 0 14px',
                                        alignSelf: 'stretch'
                                      }}
                                    >
                                      <div
                                        {...SDK_UI_MARKER}
                                        style={{
                                        width: 14,
                                        height: 17,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                        }}
                                      >
                                        <span
                                          {...SDK_UI_MARKER}
                                          aria-hidden="true"
                                          style={{
                                            width: 14,
                                            height: 14,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0
                                          }}
                                        >
                                          <span
                                            {...SDK_UI_MARKER}
                                            aria-hidden="true"
                                            style={{
                                              width: 6,
                                              height: 6,
                                              borderRadius: '50%',
                                              background: traceDotColor,
                                              flexShrink: 0
                                            }}
                                          />
                                        </span>
                                      </div>
                                      {isLastTrace ? null : (
                                        <span
                                          {...SDK_UI_MARKER}
                                          aria-hidden="true"
                                          style={{
                                            width: 1,
                                            flex: 1,
                                            minHeight: 1,
                                            borderRadius: 999,
                                            background: traceLineColor
                                          }}
                                        />
                                      )}
                                    </div>

                                  <div
                                    {...SDK_UI_MARKER}
                                    data-exocor-text="intent-detail"
                                    style={{
                                      flex: 1,
                                      paddingBottom: isLastTrace ? 0 : 8,
                                      color: traceTextColor
                                    }}
                                  >
                                    {traceLabel}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div
                              {...SDK_UI_MARKER}
                              data-exocor-text="intent-detail"
                              style={{
                                color: traceTextColor
                              }}
                            >
                              No trace captured.
                            </div>
                          )}
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
                    padding: `0 ${detailHorizontalPadding}px`
                  }}
                >
                  <div
                    {...SDK_UI_MARKER}
                    data-exocor-text="intent-detail"
                    style={{
                      color: theme.textMuted
                    }}
                  >
                    Clarification needed
                  </div>
                  <div
                    {...SDK_UI_MARKER}
                    data-exocor-text="chat-input"
                    style={{
                      color: theme.textPrimary,
                      fontFamily: GEIST_FONT,
                      fontSize: 14,
                      lineHeight: 'normal',
                      fontWeight: 300,
                      letterSpacing: '-0.07px'
                    }}
                  >
                    {pendingClarificationQuestion}
                  </div>
                </div>
              ) : null}
            </div>
          ) : pendingClarificationQuestion ? (
            <div
              {...SDK_UI_MARKER}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: `0 ${detailHorizontalPadding}px 16px`
              }}
            >
              <div
                {...SDK_UI_MARKER}
                data-exocor-text="intent-detail"
                style={{
                  color: theme.textMuted
                }}
              >
                Clarification needed
              </div>
              <div
                {...SDK_UI_MARKER}
                data-exocor-text="chat-input"
                style={{
                  color: theme.textPrimary,
                  fontFamily: GEIST_FONT,
                  fontSize: 14,
                  lineHeight: 'normal',
                  fontWeight: 300,
                  letterSpacing: '-0.07px'
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
                borderRadius: 16,
                border: `0.5px solid ${theme.panelBorder}`,
                background: theme.panelInsetSurface,
                padding: 16,
                color: theme.textMuted,
                textAlign: 'center',
                marginBottom: 16
              }}
            >
              Your history will appear here after your first intention
            </div>
          )}
        </div>

        <div {...SDK_UI_MARKER} style={{ padding: 16 }}>
          <div
            {...SDK_UI_MARKER}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              minHeight: 40,
              borderRadius: 16,
              border: `0.5px solid ${theme.inputBorder}`,
              background: theme.inputSurface,
              padding: '4px 4px 4px 16px',
              gap: 8
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
                  if (!isResolving) {
                    handleSubmit();
                  }
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
                fontFamily: GEIST_FONT,
                fontSize: 14,
                lineHeight: 'normal',
                fontWeight: 300,
                letterSpacing: '-0.07px'
              }}
            />

            <button
              {...SDK_UI_MARKER}
              type="button"
              disabled={!isResolving && !canSubmit}
              onClick={handlePrimaryAction}
              aria-label={isResolving ? 'Stop command' : 'Send command'}
              onPointerEnter={() => {
                if (!isResolving && !canSubmit) {
                  return;
                }
                setIsSendHovered(true);
              }}
              onPointerLeave={() => {
                setIsSendHovered(false);
                setIsSendPressed(false);
              }}
              onPointerDown={() => {
                if (!isResolving && !canSubmit) {
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
                width: 32,
                height: 32,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                border: 'none',
                background: sendButtonBackground,
                color: sendButtonIconColor,
                cursor: isResolving || canSubmit ? 'pointer' : 'default',
                flex: '0 0 32px',
                padding: 0,
                opacity: isResolving || canSubmit ? 1 : 0.65,
                transition: 'background-color 120ms ease, opacity 120ms ease'
              }}
            >
              {isResolving ? (
                <StopIcon size={16} color={sendButtonIconColor} />
              ) : (
                <ArrowUpIcon size={16} color={sendButtonIconColor} />
              )}
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
