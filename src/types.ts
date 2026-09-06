export type MeetEventType =
  | 'meeting_detected'
  | 'prejoin'
  | 'joining'
  | 'meeting_joined'
  | 'meeting_heartbeat'
  | 'meeting_title_changed'
  | 'meeting_reconnecting'
  | 'meeting_leaving'
  | 'meeting_ended'
  | 'tab_closed'
  | 'extension_connected'
  | 'extension_disconnected';

export interface MeetEventMessage {
  version: 1;
  type: MeetEventType;
  platform: 'google_meet';
  meetingId: string;
  title: string;
  tabId: number;
  windowId?: number;
  timestamp: number;
  confidence?: number;
  reason?: string;
}

export interface BridgeResponse {
  version: number;
  type: 'ack' | 'error' | 'recording_status';
  recording: boolean;
  meetingId?: string;
  message?: string;
}

export type MeetState =
  | 'UNKNOWN'
  | 'PRE_JOIN'
  | 'JOINING'
  | 'IN_MEETING'
  | 'RECONNECTING'
  | 'LEAVING'
  | 'ENDED';

export interface DetectionResult {
  state: MeetState;
  confidence: number;
  signals: Record<string, boolean>;
  title: string;
  meetingId: string;
}
