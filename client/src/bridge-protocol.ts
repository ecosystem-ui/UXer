export interface Anchor {
  selector: string;
  text: string;
  url?: string;
  /** Wizard step id/label captured from a stepper, if any. */
  step?: string;
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
}

// Messages sent from the parent React app to the bridge inside the iframe.
export type ParentMessage =
  | { source: 'uxer'; type: 'mode'; mode: 'browse' | 'comment' }
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
  | { source: 'uxer-bridge'; type: 'ready'; url: string; prefix: string }
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
    };

export function sendToBridge(win: Window | null, msg: ParentMessage) {
  win?.postMessage(msg, window.location.origin);
}
