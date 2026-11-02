export interface Anchor {
  selector: string;
  text: string;
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
}

// Messages sent from the parent React app to the bridge inside the iframe.
export type ParentMessage =
  | { source: 'uxer'; type: 'mode'; mode: 'browse' | 'comment' }
  | { source: 'uxer'; type: 'pins'; pins: Pin[] }
  | { source: 'uxer'; type: 'focus'; selector: string };

// Messages emitted by the bridge to the parent.
export type BridgeMessage =
  | { source: 'uxer-bridge'; type: 'ready'; url: string }
  | { source: 'uxer-bridge'; type: 'anchor'; anchor: Anchor }
  | { source: 'uxer-bridge'; type: 'location'; url: string };

export function sendToBridge(win: Window | null, msg: ParentMessage) {
  win?.postMessage(msg, '*');
}
