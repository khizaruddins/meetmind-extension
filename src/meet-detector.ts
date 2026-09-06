import type { MeetState, DetectionResult } from './types.js';

export class MeetDetector {
  private lastState: MeetState = 'UNKNOWN';
  private lastConfidence: number = 0;

  public extractMeetingId(url?: string, doc?: Document): string {
    const targetUrl =
      url ||
      (doc && doc.defaultView ? doc.defaultView.location.href : '') ||
      (typeof window !== 'undefined' ? window.location.href : '');

    const match = targetUrl.match(/meet\.google\.com\/([a-z0-9-]+)/i);
    if (match && match[1]) {
      const code = match[1].split('?')[0].split('#')[0];
      if (code !== 'landing' && code !== 'new') {
        return code;
      }
    }
    return '';
  }

  public extractMeetingTitle(doc: Document = document): string {
    // 1. Try DOM meeting title attribute/element
    const titleAttrEl = doc.querySelector('[data-meeting-title]');
    if (titleAttrEl) {
      const t = titleAttrEl.getAttribute('data-meeting-title');
      if (t && t.trim()) return t.trim();
    }

    // 2. Try meeting details region or header
    const detailHeaders = doc.querySelectorAll('div[aria-label*="Meeting details" i], [data-call-title]');
    for (const el of detailHeaders) {
      const text = el.textContent?.trim();
      if (text && text.length > 2 && text.length < 80) return text;
    }

    // 3. Try document.title
    const docTitle = doc.title;
    if (docTitle) {
      // Typically: "Meet - Architecture Review" or "Architecture Review - Google Meet"
      const cleaned = docTitle
        .replace(/^Meet\s*[-–—]\s*/i, '')
        .replace(/\s*[-–—]\s*Google Meet$/i, '')
        .replace(/\s*[-–—]\s*Meet$/i, '')
        .trim();
      if (cleaned && cleaned.toLowerCase() !== 'meet' && cleaned.toLowerCase() !== 'google meet') {
        return cleaned;
      }
    }

    const id = this.extractMeetingId(undefined, doc);
    return id ? `Google Meet (${id})` : 'Google Meet';
  }

  public detect(doc: Document = document): DetectionResult {
    const meetingId = this.extractMeetingId(undefined, doc);

    const signals: Record<string, boolean> = {
      hasMeetingId: meetingId.length >= 9, // e.g. abc-defg-hij
      hasLeaveButton: false,
      hasMicControl: false,
      hasCameraControl: false,
      hasPrejoinButton: false,
      hasReconnectingBanner: false,
      hasPostCallMarker: false,
    };

    // 1. Leave call button (The primary in-meeting indicator)
    const leaveBtn = doc.querySelector(
      'button[aria-label*="leave call" i], button[data-tooltip*="leave call" i], button[aria-label*="hang up" i]'
    );
    if (leaveBtn) {
      signals.hasLeaveButton = true;
    } else {
      // Fallback to call_end icon text inside buttons
      const buttons = doc.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent || '';
        const label = btn.getAttribute('aria-label') || '';
        if (label.toLowerCase().includes('leave') || text.includes('call_end')) {
          signals.hasLeaveButton = true;
          break;
        }
      }
    }

    // 2. In-call mic/camera controls
    const micBtn = doc.querySelector(
      'button[aria-label*="microphone" i], button[data-tooltip*="microphone" i], button[aria-label*="turn on microphone" i], button[aria-label*="turn off microphone" i]'
    );
    if (micBtn) signals.hasMicControl = true;

    const camBtn = doc.querySelector(
      'button[aria-label*="camera" i], button[data-tooltip*="camera" i], button[aria-label*="turn on camera" i], button[aria-label*="turn off camera" i]'
    );
    if (camBtn) signals.hasCameraControl = true;

    // 3. Pre-join buttons (e.g. "Join now", "Ask to join")
    const allButtons = doc.querySelectorAll('button');
    for (const b of allButtons) {
      const text = b.textContent?.trim().toLowerCase() || '';
      const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
      if (
        text === 'join now' ||
        text === 'ask to join' ||
        aria.includes('join now') ||
        aria.includes('ask to join')
      ) {
        signals.hasPrejoinButton = true;
        break;
      }
    }

    // 4. Reconnecting banner
    const bodyText = doc.body ? (doc.body.innerText || doc.body.textContent || '') : '';
    if (bodyText.includes('Reconnecting...') || bodyText.includes('Trying to reconnect')) {
      signals.hasReconnectingBanner = true;
    }

    // 5. Post-call / Ended marker
    if (
      bodyText.includes('You left the meeting') ||
      bodyText.includes('Return to home screen') ||
      doc.querySelector('[data-call-ended="true"]')
    ) {
      signals.hasPostCallMarker = true;
    }

    // Calculate Confidence Score for IN_MEETING
    let inMeetingScore = 0;
    if (signals.hasLeaveButton) inMeetingScore += 50;
    if (signals.hasMicControl) inMeetingScore += 20;
    if (signals.hasCameraControl) inMeetingScore += 10;
    if (!signals.hasPrejoinButton) inMeetingScore += 10;
    if (signals.hasMeetingId) inMeetingScore += 10;

    let state: MeetState = 'UNKNOWN';
    let confidence = 0;

    if (signals.hasPostCallMarker) {
      state = 'ENDED';
      confidence = 100;
    } else if (signals.hasReconnectingBanner && this.lastState === 'IN_MEETING') {
      state = 'RECONNECTING';
      confidence = 90;
    } else if (inMeetingScore >= 70) {
      state = 'IN_MEETING';
      confidence = inMeetingScore;
    } else if (signals.hasPrejoinButton) {
      state = 'PRE_JOIN';
      confidence = 90;
    } else if (signals.hasMeetingId) {
      state = 'PRE_JOIN';
      confidence = 50;
    }

    this.lastState = state;
    this.lastConfidence = confidence;

    return {
      state,
      confidence,
      signals,
      title: this.extractMeetingTitle(doc),
      meetingId,
    };
  }
}
