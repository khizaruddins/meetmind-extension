import { MeetDetector } from './meet-detector';
import { MeetEventType, MeetState } from './types';

class ContentController {
  private detector = new MeetDetector();
  private currentState: MeetState = 'UNKNOWN';
  private currentTitle = '';
  private currentMeetingId = '';
  private heartbeatTimer: number | null = null;
  private debounceTimer: number | null = null;

  public init(): void {
    // 1. Initial detection
    this.evaluate();

    // 2. Debounced DOM mutation observer
    const observer = new MutationObserver(() => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => this.evaluate(), 250);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'data-tooltip', 'class'],
    });

    // 3. Tab navigation / unload listener
    window.addEventListener('beforeunload', () => {
      if (this.currentState === 'IN_MEETING') {
        this.emitEvent('meeting_leaving', 'page_unloading');
      }
    });

    // 4. Document title changes
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(() => {
        const newTitle = this.detector.extractMeetingTitle();
        if (newTitle !== this.currentTitle && this.currentState === 'IN_MEETING') {
          this.currentTitle = newTitle;
          this.emitEvent('meeting_title_changed');
        }
      }).observe(titleEl, { childList: true });
    }
  }

  private evaluate(): void {
    const res = this.detector.detect(document);
    if (!res.meetingId) return;

    this.currentMeetingId = res.meetingId;
    this.currentTitle = res.title;

    if (res.state !== this.currentState) {
      const oldState = this.currentState;
      this.currentState = res.state;
      console.log(`[MeetingRecorder] State transition: ${oldState} -> ${res.state} (confidence: ${res.confidence})`);

      this.onStateChanged(oldState, res.state, res.confidence);
    }
  }

  private onStateChanged(oldState: MeetState, newState: MeetState, confidence: number): void {
    if (newState === 'PRE_JOIN') {
      this.stopHeartbeat();
      this.emitEvent('prejoin', undefined, confidence);
    } else if (newState === 'IN_MEETING') {
      this.emitEvent('meeting_joined', undefined, confidence);
      this.startHeartbeat();
    } else if (newState === 'RECONNECTING') {
      this.emitEvent('meeting_reconnecting', undefined, confidence);
    } else if (newState === 'ENDED') {
      this.stopHeartbeat();
      this.emitEvent('meeting_ended', 'post_call_detected', confidence);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.currentState === 'IN_MEETING') {
        this.emitEvent('meeting_heartbeat');
      }
    }, 3000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private emitEvent(type: MeetEventType, reason?: string, confidence?: number): void {
    const message = {
      version: 1,
      type,
      platform: 'google_meet',
      meetingId: this.currentMeetingId,
      title: this.currentTitle,
      timestamp: Date.now(),
      confidence,
      reason,
    };

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          // Worker might be waking up
        } else if (response) {
          // Acknowledged by background
        }
      });
    } catch (e) {
      console.error('[MeetingRecorder] Failed to send message to extension background:', e);
    }
  }
}

const controller = new ContentController();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => controller.init());
} else {
  controller.init();
}
