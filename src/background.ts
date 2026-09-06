import { NativeMessagingBridge } from './native-messaging';
import { MeetEventMessage } from './types';

const bridge = new NativeMessagingBridge((resp) => {
  console.log('[MeetingRecorder:BG] Response from desktop:', resp);
});

// Map active meeting tabId -> { meetingId, title }
const activeMeetTabs = new Map<number, { meetingId: string; title: string }>();

// Connect bridge on worker start
bridge.connect();

// 1. Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message: Partial<MeetEventMessage>, sender, sendResponse) => {
  if (!sender.tab || !sender.tab.id) return;

  const tabId = sender.tab.id;
  const windowId = sender.tab.windowId;

  const fullMessage: MeetEventMessage = {
    version: 1,
    type: message.type || 'meeting_detected',
    platform: 'google_meet',
    meetingId: message.meetingId || '',
    title: message.title || 'Google Meet',
    tabId,
    windowId,
    timestamp: message.timestamp || Date.now(),
    confidence: message.confidence,
    reason: message.reason,
  };

  // Track active meetings for tab close detection
  if (fullMessage.type === 'meeting_joined' || fullMessage.type === 'prejoin') {
    activeMeetTabs.set(tabId, {
      meetingId: fullMessage.meetingId,
      title: fullMessage.title,
    });
  } else if (fullMessage.type === 'meeting_ended') {
    activeMeetTabs.delete(tabId);
  }

  // Forward to Native Messaging Bridge
  bridge.send(fullMessage);
  sendResponse({ received: true });
});

// 2. Tab close detection
chrome.tabs.onRemoved.addListener((tabId) => {
  const tracked = activeMeetTabs.get(tabId);
  if (tracked) {
    console.log(`[MeetingRecorder:BG] Tab ${tabId} closed for meeting ${tracked.meetingId}. Emitting meeting_ended.`);
    activeMeetTabs.delete(tabId);

    const endMessage: MeetEventMessage = {
      version: 1,
      type: 'tab_closed',
      platform: 'google_meet',
      meetingId: tracked.meetingId,
      title: tracked.title,
      tabId,
      timestamp: Date.now(),
      reason: 'tab_closed',
    };

    bridge.send(endMessage);
  }
});

// 3. Tab navigation away from meet.google.com
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    const isMeet = changeInfo.url.startsWith('https://meet.google.com/');
    const tracked = activeMeetTabs.get(tabId);
    if (tracked && !isMeet) {
      console.log(`[MeetingRecorder:BG] Tab ${tabId} navigated away from Meet. Emitting meeting_ended.`);
      activeMeetTabs.delete(tabId);

      const navMessage: MeetEventMessage = {
        version: 1,
        type: 'meeting_ended',
        platform: 'google_meet',
        meetingId: tracked.meetingId,
        title: tracked.title,
        tabId,
        timestamp: Date.now(),
        reason: 'navigated_away',
      };

      bridge.send(navMessage);
    }
  }
});
