# Blockly STEM App

This is a React Native mobile application built with [Expo](https://expo.dev/) designed to interact with hardware robots (like ESP32/STM32) via Bluetooth Low Energy (BLE) and USB Serial. It provides a visual programming interface using Google Blockly embedded within a WebView.

## Features

*   **Visual Programming Environment**: Embeds a Blockly-based workspace (`assets/blockly/index.html`) using `react-native-webview`, allowing users to drag and drop code blocks.
*   **Bluetooth Low Energy (BLE)**: Integrates `react-native-ble-plx` to scan, connect, and upload generated code wirelessly to robot boards (currently set to look for devices with "ESP32" in their name). Code is transmitted in chunks using base64 encoding.
*   **USB Serial Communication**: Uses `rn-usb-serial` (on supported Android devices) to send code over a direct USB connection.
*   **Cross-platform Structure**: Contains logic to handle Web, Android, and iOS environments differently (e.g., loading an `iframe` on the web versus a `WebView` on mobile platforms).

## Architecture & Core Components

### `App.js`
The main entry point of the application. It handles:
1.  **Permissions**: Requests necessary Bluetooth and Location permissions on Android.
2.  **BLE Management**: Initializes `BleManager`, manages the connection state, and handles chunked data transmission (`sendToBoardBLE`).
3.  **USB Serial Management**: Initializes and manages USB connections (`startUsbService`, `sendToBoardUSB`) on Android.
4.  **Message Bridge**: Listens for messages from the embedded Webview (`CONNECT_BLE`, `SEND_DATA`, `python_upload`) and routes them to the appropriate native hardware functions.
5.  **UI**: Renders the application in full-screen Landscape mode, displaying the Blockly web app.

### Blockly Assets
*   `assets/blockly/index.html`: The HTML file loaded by the WebView. It contains the logic for rendering the Blockly workspace and sending messages back to React Native.

## Communication Protocol
The app communicates with the hardware using specific commands:

### BLE Protocol
*   **Service UUID**: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
*   **Write UUID**: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
*   Data is base64 encoded and sent in 20-byte chunks.
*   Session is wrapped with `@@START\n` and `\n@@END` markers.

### Python / USB Protocol
*   Sends a formatted string containing the entry point, code size, and the raw Python code.
    Format:
    ```
    PYCODE
    ENTRY:<entry_point>
    SIZE:<size>

    

    ```

## Development Setup

### Prerequisites
*   Node.js (> 18.x recommended)
*   Expo CLI (`npm install -g expo-cli`)
*   EAS CLI for native builds (`npm install -g eas-cli`) -> *Required because of native BLE/Serial modules.*

### Running the App
Since this app relies on native modules (`react-native-ble-plx`, `rn-usb-serial`) that are not available in the standard Expo Go app, you will need to create a custom development build.

1.  **Install dependencies**:
    ```bash
    npm install
    # or
    yarn install
    ```

2.  **Start for Web** (Limited functionality, no BLE/USB):
    ```bash
    npx expo start --web
    ```

3.  **Run on Android (Physical Device Recommended)**:
    ```bash
    npx expo run:android
    ```

4.  **Run on iOS (Physical Device Recommended)**:
    ```bash
    npx expo run:ios
    ```

*(Note for BLE and USB functionalities to work, testing must be done on physical Android/iOS devices.)*
