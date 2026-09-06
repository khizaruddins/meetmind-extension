import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { MeetDetector } from '../src/meet-detector.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFixture(name, url = 'https://meet.google.com/abc-defg-hij') {
  const filePath = path.join(__dirname, 'fixtures', name);
  const html = fs.readFileSync(filePath, 'utf-8');
  const dom = new JSDOM(html, { url });
  return dom.window.document;
}

test('prejoin.html detects PRE_JOIN state', () => {
  const doc = loadFixture('prejoin.html');
  const detector = new MeetDetector();
  const res = detector.detect(doc);

  assert.strictEqual(res.state, 'PRE_JOIN');
  assert.strictEqual(res.meetingId, 'abc-defg-hij');
  assert.strictEqual(res.signals.hasPrejoinButton, true);
  assert.strictEqual(res.signals.hasLeaveButton, false);
  assert.strictEqual(res.title, 'Architecture Review');
});

test('in-meeting.html detects IN_MEETING state with high confidence', () => {
  const doc = loadFixture('in-meeting.html');
  const detector = new MeetDetector();
  const res = detector.detect(doc);

  assert.strictEqual(res.state, 'IN_MEETING');
  assert.strictEqual(res.meetingId, 'abc-defg-hij');
  assert.strictEqual(res.signals.hasLeaveButton, true);
  assert.strictEqual(res.signals.hasMicControl, true);
  assert.strictEqual(res.signals.hasCameraControl, true);
  assert.strictEqual(res.signals.hasPrejoinButton, false);
  assert.strictEqual(res.title, 'Architecture Review');
  assert.ok(res.confidence >= 70, `Expected confidence >= 70, got ${res.confidence}`);
});

test('reconnecting.html detects RECONNECTING state when previously IN_MEETING', () => {
  const inMeetingDoc = loadFixture('in-meeting.html');
  const detector = new MeetDetector();
  detector.detect(inMeetingDoc); // prime with IN_MEETING

  const reconnectDoc = loadFixture('reconnecting.html');
  const res = detector.detect(reconnectDoc);

  assert.strictEqual(res.state, 'RECONNECTING');
  assert.strictEqual(res.signals.hasReconnectingBanner, true);
  assert.ok(res.confidence >= 80);
});

test('post-call.html detects ENDED state', () => {
  const doc = loadFixture('post-call.html');
  const detector = new MeetDetector();
  const res = detector.detect(doc);

  assert.strictEqual(res.state, 'ENDED');
  assert.strictEqual(res.signals.hasPostCallMarker, true);
  assert.strictEqual(res.confidence, 100);
});

test('extractMeetingId parses URL correctly', () => {
  const detector = new MeetDetector();
  assert.strictEqual(detector.extractMeetingId('https://meet.google.com/foo-bar-baz'), 'foo-bar-baz');
  assert.strictEqual(detector.extractMeetingId('https://meet.google.com/foo-bar-baz?authuser=0'), 'foo-bar-baz');
  assert.strictEqual(detector.extractMeetingId('https://meet.google.com/new'), '');
  assert.strictEqual(detector.extractMeetingId('https://meet.google.com/landing'), '');
});
