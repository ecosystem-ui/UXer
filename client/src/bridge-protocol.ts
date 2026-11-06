export interface Anchor {
  selector: string;
  text: string;
  url?: string;
  /** Wizard step id/label captured from a stepper, if any. */
  step?: string;
  /** View-state key this anchor was captured in (empty means "any state"). */
  state?: string;
  /** How the state key was produced: 'declarative' | 'auto'. */
  stateMode?: string;
  x: number;
  y: number;
}

export interface Pin {
  id: string;
  selector: string;
  x: number;
  y: number;
  status: 'open' | 'resolved';
  index: number;
  /** Design URL (page) this pin belongs to; empty means "any page". */
  url: string;
  /** Wizard step id/label this pin lives on, if any. */
  step?: string;
  /** View-state key this pin lives in; empty means "any state". */
  state?: string;
}

/** One declarative, state-bearing control for a known prototype. */
export interface StateControl {
  key: string;
  selector: string;
  /** Value extractor: 'text' | 'value' | 'checked' | 'id' | 'wizard-step' | 'attr:<name>'. */
  value: string;
  activate?: 'click';
}

/** Persona-level declarative state config, sent to the bridge. */
export interface StateConfig {
  controls: StateControl[];
}

// Messages sent from the parent React app to the bridge inside the iframe.
export type ParentMessage =
  | { source: 'uxer'; type: 'mode'; mode: 'browse' | 'comment' }
  | { source: 'uxer'; type: 'config'; state: StateConfig | null }
  | { source: 'uxer'; type: 'pins'; pins: Pin[] }
  | {
      source: 'uxer';
      type: 'focus';
      selector: string;
      step?: string;
      persist?: boolean;
      id?: string;
    }
  | {
      source: 'uxer';
      type: 'navigate';
      url: string;
      selector: string;
      step?: string;
      persist?: boolean;
      id?: string;
    }
  | { source: 'uxer'; type: 'clear' };

// Messages emitted by the bridge to the parent.
export type BridgeMessage =
  | { source: 'uxer-bridge'; type: 'ready'; url: string }
  | { source: 'uxer-bridge'; type: 'anchor'; anchor: Anchor }
  | { source: 'uxer-bridge'; type: 'location'; url: string }
  | {
      source: 'uxer-bridge';
      type: 'step-blocked';
      id?: string;
      selector: string;
      step?: string;
      stepLabel?: string;
      reason?: string;
    }
  | {
      source: 'uxer-bridge';
      type: 'step-reached';
      id?: string;
    };

export function sendToBridge(win: Window | null, msg: ParentMessage) {
  // The preview runs on a persona origin (a subdomain of ours), so target it
  // explicitly rather than assuming same-origin.
  win?.postMessage(msg, '*');
}
