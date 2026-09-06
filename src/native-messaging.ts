import { MeetEventMessage, BridgeResponse } from './types';

const HOST_NAME = 'com.meetingrecorder.bridge';

export class NativeMessagingBridge {
  private port: chrome.runtime.Port | null = null;
  private isConnecting = false;
  private messageQueue: MeetEventMessage[] = [];

  constructor(private onResponseCallback?: (resp: BridgeResponse) => void) {}

  public connect(): void {
    if (this.port || this.isConnecting) return;

    this.isConnecting = true;
    try {
      console.log(`[MeetingRecorder] Connecting to Native Messaging host: ${HOST_NAME}`);
      this.port = chrome.runtime.connectNative(HOST_NAME);

      this.port.onMessage.addListener((msg: BridgeResponse) => {
        console.log('[MeetingRecorder] Native host response:', msg);
        if (this.onResponseCallback) this.onResponseCallback(msg);
      });

      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.warn('[MeetingRecorder] Native host disconnected:', error?.message || 'closed');
        this.port = null;
        this.isConnecting = false;
      });

      this.isConnecting = false;

      // Flush queued messages
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift();
        if (msg) this.send(msg);
      }
    } catch (e) {
      console.error('[MeetingRecorder] Failed to connect to native messaging host:', e);
      this.port = null;
      this.isConnecting = false;
    }
  }

  public send(message: MeetEventMessage): void {
    if (!this.port) {
      this.messageQueue.push(message);
      this.connect();
      return;
    }

    try {
      this.port.postMessage(message);
    } catch (e) {
      console.error('[MeetingRecorder] Error posting message to native host:', e);
      this.port = null;
      this.messageQueue.push(message);
      this.connect();
    }
  }

  public isConnected(): boolean {
    return this.port !== null;
  }
}
