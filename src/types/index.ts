import type { ReactNode } from 'react';

/** Supported input modalities. */
export type Modality = 'voice' | 'gaze' | 'gesture';

/** Supported primitive actions that can be executed against the host app. */
export type IntentActionType = 'click' | 'navigate' | 'fill' | 'submit' | 'scroll' | 'tool';
/** Supported sequence step actions. */
export type IntentStepAction = IntentActionType | 'wait';

/** Source that produced an intent. */
export type IntentSource = 'claude' | 'deterministic' | 'manual';

/** Input channel that submitted a command into the resolver pipeline. */
export type CommandInputMethod = 'voice' | 'text' | 'gesture';

/** Supported tool parameter primitive types. */
export type ExocorToolParameterType = 'string' | 'number' | 'boolean' | 'enum';
/** Safety hint surfaced to planning for registered app-native tools. */
export type ExocorToolSafety = 'read' | 'write' | 'destructive';

/** One declared parameter for an explicit app-native tool. */
export interface ExocorToolParameter {
  name: string;
  description: string;
  type?: ExocorToolParameterType;
  required?: boolean;
  options?: string[];
}

/** Public planner-safe metadata for an explicit app-native tool. */
export interface ExocorToolMetadata {
  id: string;
  description: string;
  parameters?: ExocorToolParameter[];
  routes?: string[];
  safety?: ExocorToolSafety;
}

/** Runtime tool definition registered with SpatialProvider. */
export interface ExocorToolDefinition extends ExocorToolMetadata {
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/** Host tool definition that can be surfaced to higher-level SDK registries. */
export interface AppTool {
  name: string;
  description: string;
  execute: (...args: unknown[]) => unknown | Promise<unknown>;
}

/** Represents one interactive capability discovered in the host DOM. */
export interface DOMElementDescriptor {
  id: string;
  selector: string;
  label: string;
  text: string;
  fillable?: boolean;
  componentName?: string | null;
  handlers?: string[];
  props?: Record<string, string | number | boolean | null>;
  state?: Array<string | number | boolean | null | Record<string, string | number | boolean | null>>;
  visible?: boolean;
  role: string;
  tagName: string;
  type?: string;
  href?: string;
  ariaLabel?: string;
  ariaDescription?: string;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
  dataState?: string | null;
  dataStatus?: string | null;
  ariaExpanded?: string | null;
  ariaSelected?: string | null;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/** Minimal semantic element entry sent to Claude. */
export interface CompressedElementDescriptor {
  id: string;
  componentName: string;
  tag: string;
  type: string;
  fillable: boolean;
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  ariaLabel: string;
  text: string;
  handlers: string[];
  propHints: string[];
  stateHints: string[];
  count: number;
}

export type AppMapLocatorKind = 'navigation' | 'button' | 'tab' | 'filter' | 'modalTrigger' | 'formField' | 'submit';

export interface AppMapLocatorRef {
  id: string;
  kind: AppMapLocatorKind;
  label: string;
  labelKey: string;
  selectorCandidates: string[];
  path?: string;
  clickable?: boolean;
  fillable?: boolean;
  tagName?: string;
  role?: string;
}

/** Route-level semantic map captured during first-run app discovery. */
export interface RouteMap {
  path: string;
  componentName: string;
  title: string;
  navigationLinks: Array<{ label: string; path: string; elementId?: string; selectorCandidates?: string[] }>;
  modalTriggers: Array<{
    elementId: string;
    label: string;
    selectorCandidates?: string[];
    modalContents: {
      formFields: Array<{
        label: string;
        type: string;
        required: boolean;
        options?: string[];
        elementId?: string;
        selectorCandidates?: string[];
      }>;
      buttons: Array<{ label: string; elementId?: string; selectorCandidates?: string[] }>;
    };
  }>;
  formFields: Array<{
    elementId: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
    selectorCandidates?: string[];
  }>;
  buttons: Array<{ elementId: string; label: string; selectorCandidates?: string[] }>;
  filters: Array<{ elementId: string; label: string; options: string[]; selectorCandidates?: string[] }>;
  tabs: Array<{ elementId: string; label: string; selectorCandidates?: string[] }>;
  locators?: AppMapLocatorRef[];
  headings: string[];
}

/** Cached cross-route app capability map saved in localStorage. */
export interface AppMap {
  version: string;
  discoveredAt: number;
  routeCount: number;
  routes: RouteMap[];
}

/** Concise app-map route summary included in Claude context. */
export interface AppMapRouteSummary {
  path: string;
  title: string;
  navigationLinks: Array<{ label: string; path: string }>;
  buttons: string[];
  tabs: string[];
  modalTriggers: Array<{
    label: string;
    formFields: Array<{ label: string; type: string }>;
    submitButton: string;
  }>;
  filters: string[];
}

/** Token-capped app-map summary sent to Claude. */
export interface AppMapSummary {
  version: string;
  routeCount: number;
  tokenEstimate: number;
  routes: AppMapRouteSummary[];
}

/** Route-aware planner-visible entry for an explicit tool. */
export interface ToolCapabilityEntry extends ExocorToolMetadata {
  parameters: ExocorToolParameter[];
  routes: string[];
  safety: ExocorToolSafety;
  isGlobal: boolean;
  currentRouteMatches: boolean;
  requiresNavigation: boolean;
  semanticScore: number;
  preferredForCommand: boolean;
  preferredReason?: string;
}

/** Explicit tool capability map sent alongside the learned app model. */
export interface ToolCapabilityMap {
  currentRoute: string;
  preferredToolIds: string[];
  tools: ToolCapabilityEntry[];
}

/** Compressed capability context sent to the resolver model. */
export interface CompressedCapabilityMap {
  pageSummary: string;
  currentRoute: string;
  currentUrl: string;
  routes: string[];
  gazeTargetId: string | null;
  elements: CompressedElementDescriptor[];
  selectorMap: Record<string, string>;
  tableSummary: string;
  listSummary: string;
  appMap?: AppMap | AppMapSummary | null;
  tokenEstimate: number;
}

/** Aggregated capability map for intent resolution and local execution. */
export interface DOMCapabilityMap {
  elements: DOMElementDescriptor[];
  routes: string[];
  currentRoute: string;
  currentUrl: string;
  routeParams: Record<string, string>;
  pageTitle: string;
  headings: Array<{ level: 'h1' | 'h2' | 'h3'; text: string }>;
  navigation: Array<{ label: string; href: string; selector: string }>;
  formState: Array<{
    selector: string;
    name: string;
    label: string;
    type: string;
    value: string;
    disabled: boolean;
  }>;
  buttonsState: Array<{
    selector: string;
    label: string;
    disabled: boolean;
    loading: boolean;
  }>;
  visibleErrors: string[];
  dialogs: Array<{ selector: string; label: string; isOpen: boolean }>;
  tableRows: Array<{ context: string; columns: string[] }>;
  listItems: Array<{ context: string; text: string }>;
  cards: Array<{ title: string; text: string }>;
  statusBadges: Array<{ text: string; selector: string }>;
  stateHints: Array<{
    selector: string;
    dataState: string | null;
    dataStatus: string | null;
    ariaExpanded: string | null;
    ariaSelected: string | null;
  }>;
  activeItems: string[];
  countBadges: Array<{ text: string; count: number | null; selector: string }>;
  compressed: CompressedCapabilityMap;
  updatedAt: number;
}

/** Shape of the voice state surfaced to SDK consumers. */
export interface VoiceState {
  transcript: string;
  isListening: boolean;
  confidence: number;
}

/** Shape of the gaze state surfaced to SDK consumers. */
export interface GazeState {
  gazeTarget: string | null;
  gazeX: number;
  gazeY: number;
  isCalibrated: boolean;
}

/** Shape of the gesture state surfaced to SDK consumers. */
export interface GestureState {
  gesture: 'none' | 'pinch';
  hand: 'left' | 'right' | 'unknown';
  confidence: number;
}

/** Unified action object returned by the intent resolver. */
export interface IntentAction {
  action: IntentActionType;
  target: string;
  value: string | null;
  toolId?: string;
  args?: Record<string, unknown> | null;
  confidence: number;
  source: IntentSource;
  rawCommand: string;
}

/** One executable step in a multi-step plan. */
export interface IntentStep {
  action: IntentStepAction;
  /** element id (e.g. e12) or route path */
  target?: string;
  value?: string | null;
  toolId?: string;
  args?: Record<string, unknown> | null;
  waitForDOM?: boolean;
  reason: string;
  ms?: number;
}

/** Multi-step plan produced by deterministic or Claude resolution. */
export interface IntentPlan {
  source: IntentSource;
  rawCommand: string;
  confidence: number;
  steps: IntentStep[];
}

/** Status shown to developers and the chat bar after resolution attempts. */
export type ResolutionStatus = 'idle' | 'resolving' | 'executed' | 'unresolved' | 'failed';

/** State exposed by useIntent. */
export interface IntentState {
  lastIntent: IntentAction | null;
  isResolving: boolean;
  resolutionStatus: ResolutionStatus;
  resolvedIntentPreview: string | null;
  progressMessage: string | null;
  execute: (command: string, inputMethod?: CommandInputMethod) => Promise<boolean>;
}

/** State exposed by useDOMMap. */
export interface DOMMapState {
  elements: DOMElementDescriptor[];
  routes: string[];
  refresh: () => void;
}

/** Resolver execution strategy based on app-map coverage and dynamic-target signals. */
export type ResolutionPriority = 'app_map_only' | 'route_then_dom' | 'dom_only';

/** Streaming resolver result. */
export type ResolvedIntent = { type: 'dom_steps'; plan: IntentPlan; resolutionPriority: ResolutionPriority } | {
  type: 'text_response';
  text: string;
} | null;
/** Props for the SpatialProvider root wrapper. */
export interface SpatialProviderProps {
  children: ReactNode;
  backendUrl?: string;
  modalities?: Modality[];
  debug?: boolean;
  tools?: ExocorToolDefinition[];
  /** Called when a fresh app map is discovered or loaded from cache. */
  onAppMapped?: (appMap: AppMap) => void;
}

/** Context passed into the intent resolver. */
export interface IntentResolutionInput {
  command: string;
  inputMethod: CommandInputMethod;
  map: DOMCapabilityMap;
  appMap?: AppMap | null;
  toolCapabilityMap?: ToolCapabilityMap | null;
  gazeTarget: string | null;
  gesture: GestureState['gesture'];
  completedSteps?: IntentStep[];
}

/** Outcome of action execution. */
export interface ExecutionResult {
  executed: boolean;
  reason?: string;
}

/** Outcome of sequence execution, including step-level failure context. */
export interface SequenceExecutionResult extends ExecutionResult {
  completedSteps: number;
  failedStep?: IntentStep;
  failedStepReason?: string;
  successDescription?: string;
  lastCompletedStep?: IntentStep;
  newElementsAfterWait?: DOMElementDescriptor[];
}
