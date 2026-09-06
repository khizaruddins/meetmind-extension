# MeetMind Google Meet Browser Extension (`recorder-extension`)

[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-4285F4?style=flat-square&logo=google-chrome)](https://developer.chrome.com/docs/extensions/mv3/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
[![Tests](https://img.shields.io/badge/Tests-5%2F5%20Passing-brightgreen?style=flat-square)](https://jestjs.io/)
[![Zero-Media Privacy](https://img.shields.io/badge/Privacy-Zero%20Media%20Access-success?style=flat-square)](#security--privacy-guarantees)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](#license)

A lightweight, zero-media Manifest V3 browser extension engineered for **Google Meet** call lifecycle automation. By pairing semantic DOM mutation heuristics with a secure Native Messaging bridge, the extension automatically orchestrates meeting recording in the MeetMind desktop application without ever capturing or touching raw media in the browser.

---

## 📑 Table of Contents

- [Architectural Overview](#-architectural-overview)
- [Zero-Media Security & Privacy Model](#-zero-media-security--privacy-model)
- [Lifecycle Detection State Machine](#-lifecycle-detection-state-machine)
- [Native Messaging Bridge Protocol](#-native-messaging-bridge-protocol)
- [Directory Structure](#-directory-structure)
- [Installation & Setup](#-installation--setup)
  - [Option A: Quick Installation via ZIP (Recommended)](#option-a-quick-installation-via-zip-recommended)
  - [Option B: Build & Install from Source (Developers)](#option-b-build--install-from-source-developers)
- [Automated Testing](#-automated-testing)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [License](#-license)

---

## 🏛 Architectural Overview

```
Google Meet Call (meet.google.com)
      │
      ▼ (MutationObserver + semantic element analysis)
content.ts
      │
      ▼ (chrome.runtime.sendMessage - JSON)
background.ts (Service Worker)
      │
      ▼ (chrome.runtime.connectNative("com.meetingrecorder.bridge"))
recorder-bridge (Rust Native Messaging Binary)
      │
      ▼ (Unix Domain Socket: /run/user/<UID>/meetingrecorder.sock)
Tauri Desktop App (`MeetingAutomationManager` -> `recorder-core`)
```

---

## 🔒 Zero-Media Security & Privacy Model

Most browser recorder extensions request invasive browser screen and microphone capture permissions (`chrome.tabCapture` / `getUserMedia`). MeetMind takes a radically different, privacy-first architectural approach:

1. **Zero Browser Media Access**: The extension **never** opens or records audio, video, or screen streams in JavaScript. All media encoding is performed locally by `recorder-core` using native OS APIs (PipeWire / X11 / WASAPI / ScreenCaptureKit).
2. **Minimal Manifest Scope**: Host permissions are strictly restricted to `https://meet.google.com/*`. No access to Google Docs, Gmail, or any other web domain.
3. **No External Network Requests**: The extension sends zero telemetry, analytics, or payloads over the public internet. Communication is purely local to the host machine.
4. **UID-Restricted Local IPC**: The Native Messaging bridge forwards events over a local Unix Domain Socket owned strictly by the current user's UID (`0700` permissions). No open TCP ports or network attack vectors.
5. **Deterministic Extension ID**: Uses a fixed RSA key in `manifest.json` producing extension ID `imbjlkaabfmgfonlpnedfdabkokejblf`, matching the allowed origins in the Chrome Native Messaging manifest.

---

## 🔄 Lifecycle Detection State Machine

The extension's semantic detector continuously assesses Google Meet DOM nodes, computing confidence scores for each lifecycle state:

```
                    ┌─────────────────────────┐
                    │      URL Visited        │
                    │ (meet.google.com/xxx-*) │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │       `prejoin`         │
                    │ ("Ready to join?" view) │
                    └────────────┬────────────┘
                                 │ Confidence >= 70% (Leave button, mic/cam icons detected)
                                 ▼
                    ┌─────────────────────────┐
 ┌─────────────────►│    `meeting_joined`     │◄──────────────────┐
 │                  │ (Recording auto-starts) │                   │
 │                  └────────────┬────────────┘                   │
 │                               │                                │
 │ 3s Watchdog Heartbeat         │ Network Interruption           │ Network Restored
 │ (`meeting_heartbeat`)         ▼                                │
 │                  ┌─────────────────────────┐                   │
 │                  │  `meeting_reconnecting` ├───────────────────┘
 │                  │ (Recording kept alive)  │
 │                  └────────────┬────────────┘
 │                               │
 │                               │ "Leave Call" clicked OR Tab Closed
 │                               ▼
 │                  ┌─────────────────────────┐
 └──────────────────┤    `meeting_leaving`    │
                    │ (Recording auto-stops)  │
                    └─────────────────────────┘
```

### Event Specification

| Event Type | Trigger Condition | Action in Desktop App |
| :--- | :--- | :--- |
| `prejoin` | User visits `meet.google.com/abc-defg-hij` and sees pre-join lobby. | Sets up meeting metadata and waits for user join. |
| `meeting_joined` | Call controls and leave button detected with confidence >= 70%. | Triggers native `recorder_start()` in `recorder-core`. |
| `meeting_heartbeat` | 3-second periodic pulse sent while actively in call. | Resets watchdog timer, preventing orphaned recordings. |
| `meeting_title_changed` | DOM meeting title or header details update. | Dynamically updates output file metadata. |
| `meeting_reconnecting` | "Reconnecting..." or network glitch banner appears. | Pauses watchdog cutoffs; maintains active recording. |
| `meeting_leaving` | User clicks the red "Leave call" button or navigates away. | Triggers native `recorder_stop()` and remuxes to MP4. |
| `tab_closed` | Active meeting tab was closed in browser window. | Cleanly finalizes recording and releases media handles. |

---

## 📡 Native Messaging Bridge Protocol

Communication between `background.ts` and the native host (`recorder-bridge`) strictly adheres to the Chrome Native Messaging specification:

- **Message Framing**: Each JSON message is preceded by a 32-bit unsigned integer (4 bytes, little-endian) representing message length.
- **Payload Schema**:
  ```json
  {
    "event": "meeting_joined",
    "meetingId": "abc-defg-hij",
    "meetingTitle": "Weekly Architecture Sync",
    "timestamp": 1772718300000,
    "confidence": 0.95
  }
  ```

---

## 📂 Directory Structure

```
recorder-extension/
├── MeetMind-Chrome-Extension-v1.0.0.zip # Pre-built extension package (unzip & load)
├── manifest.json                       # Manifest V3 configuration & permissions
├── package.json                        # Dependencies, test scripts, and build tools
├── tsconfig.json                       # TypeScript compiler options
├── vite.config.ts                      # Bundler configuration targeting extension scripts
├── src/
│   ├── background.ts                   # Service worker managing tabs and native port
│   ├── content.ts                      # Injected content script running DOM observer
│   ├── meet-detector.ts                # Semantic DOM heuristic evaluation engine
│   ├── native-messaging.ts             # Native messaging byte-level framing client
│   └── types.ts                        # TypeScript interfaces for events and DOM states
└── tests/
    ├── detector.test.js                # Jest test suite running against Google Meet fixtures
    └── fixtures/                       # Real-world Google Meet HTML snapshots
        ├── prejoin.html                # Pre-call lobby HTML fixture
        ├── in-meeting.html             # Active multi-participant call fixture
        ├── reconnecting.html           # Network reconnection banner fixture
        └── ended.html                  # Meeting ended screen fixture
```

---

## 🚀 Installation & Setup

### Option A: Quick Installation via ZIP (Recommended)

Follow these simple steps to load the extension directly in Google Chrome:

1. **Download the Extension ZIP**:
   - Download [`MeetMind-Chrome-Extension-v1.0.0.zip`](./MeetMind-Chrome-Extension-v1.0.0.zip) to a folder on your computer.

2. **Unzip into a Folder**:
   - Extract the contents of `MeetMind-Chrome-Extension-v1.0.0.zip` to a folder of your choice (e.g., `~/Downloads/MeetMind-Extension` or `C:\Extensions\MeetMind`).
   - Verify that the unzipped folder contains `manifest.json`, `background.js`, `content.js`, and the `icons/` folder.

3. **Open Chrome Extensions**:
   - Open Google Chrome and navigate to:
     ```text
     chrome://extensions
     ```
     *(Or open Chrome menu **⋮** > **Extensions** > **Manage Extensions**).*

4. **Enable Developer Mode**:
   - In the top-right corner of the Extensions page, switch the **Developer mode** toggle to **ON**.

5. **Load Unpacked Extension**:
   - Click the **Load unpacked** button in the top-left toolbar.

6. **Select the Unzipped Folder**:
   - In the file picker dialog, select the specific folder where you unzipped the extension (the folder containing `manifest.json`).
   - Click **Select Folder** (or **Open**).

7. **Ready to Use**:
   - **MeetMind Google Meet Browser Extension** will now appear in your active extensions with ID `imbjlkaabfmgfonlpnedfdabkokejblf`!

---

### Option B: Build & Install from Source (Developers)

If you prefer building directly from the TypeScript source code:

1. **Install Dependencies**:
   ```bash
   cd /home/khizaruddin/practice/fullapp/recorder-extension
   npm install
   ```

2. **Compile the Extension**:
   ```bash
   npm run build
   ```

3. **Load in Chrome or Edge**:
   - Navigate to `chrome://extensions/` (or `edge://extensions/`).
   - Enable **Developer mode** in the top right corner.
   - Click **Load unpacked**.
   - Select this extension folder (`/home/khizaruddin/practice/fullapp/recorder-extension`).
   - The extension will load with ID `imbjlkaabfmgfonlpnedfdabkokejblf`.

---

## 🧪 Automated Testing

The detector logic is verified against static HTML fixtures captured from live Google Meet sessions:

```bash
npm test
```

### Verification Suite
- `prejoin` state detection (verifies join button heuristics)
- `in-meeting` state detection (verifies confidence score >= 70%)
- `reconnecting` network interruption detection
- `ended` call teardown detection
- Debounced DOM mutation performance (< 5ms evaluation overhead)

Result: **5/5 tests passing**.

---

## ❓ Troubleshooting & FAQ

### 1. Native host connection fails (`Specified native messaging host not found`)
- Ensure the native host manifest is installed at:
  `~/.config/google-chrome/NativeMessagingHosts/com.meetingrecorder.bridge.json`
- Verify the binary path inside the manifest points to an executable `recorder-bridge` binary.

### 2. Meeting does not auto-start upon joining
- Inspect DevTools console on `https://meet.google.com/*`.
- Verify the extension logged: `[MeetDetector] State transition: in_meeting (confidence: 0.95)`.
- Ensure the MeetMind desktop client is running and listening on the Unix Domain Socket.

---

## 📄 License

Proprietary Software. All rights reserved © 2026 MeetMind Inc.
