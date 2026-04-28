import { useAssets } from 'expo-asset';
import React, { useEffect, useCallback, useState } from "react";
import { Platform, View, Alert, DeviceEventEmitter, PermissionsAndroid } from "react-native";
import { WebView } from "react-native-webview";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";

import { BleManager } from 'react-native-ble-plx';
import base64 from 'react-native-base64';

const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const WRITE_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

let RNSerialport = null;
let SerialActions = null;

function buildPycodeMessage(code, entry = "main") {
  const size = code.length;
  return `PYCODE\nENTRY:${entry}\nSIZE:${size}\n\n${code}`;
}

function ensureSerialModule() {
  if (Platform.OS !== "android") return false;
  if (RNSerialport && SerialActions) return true;
  try {
    const Serial = require("rn-usb-serial");
    RNSerialport = Serial.RNSerialport;
    SerialActions = Serial.actions;
    return true;
  } catch (e) {
    console.warn("Unable to load rn-usb-serial:", e);
    return false;
  }
}

function startUsbService() {
  if (!ensureSerialModule()) return;
  DeviceEventEmitter.addListener(
    SerialActions.ON_CONNECTED,
    () => console.log("USB: Connected")
  );
  DeviceEventEmitter.addListener(
    SerialActions.ON_DISCONNECTED,
    () => console.log("USB: Disconnected")
  );
  try {
    RNSerialport.setInterface(-1);
    RNSerialport.setAutoConnectBaudRate(115200);
    RNSerialport.setAutoConnect(true);
    RNSerialport.startUsbService();
  } catch (e) {
    console.warn("Failed to start USB service:", e);
  }
}

function stopUsbService() {
  if (!RNSerialport || Platform.OS !== "android") return;
  try {
    DeviceEventEmitter.removeAllListeners();
    RNSerialport.stopUsbService();
  } catch (e) {
    console.warn("Error stopping USB service:", e);
  }
}

function sendToBoardUSB(message) {
  if (!ensureSerialModule()) return;
  try {
    RNSerialport.writeString(message);
    Alert.alert("USB Sent", "Code sent over USB.");
  } catch (e) {
    Alert.alert("USB Error", "Failed to send.");
  }
}

export default function App() {
  const blocklyRef = React.useRef(null); // Blockly WebView ref
  const trainRef = React.useRef(null); // Train WebView ref (native)

  const [connectedDevice, setConnectedDevice] = React.useState(null);
  const [showAIScreen, setShowAIScreen] = React.useState(false);

  const [bleManager] = React.useState(() => {
    if (Platform.OS !== 'web') {
      try {
        return new BleManager();
      } catch (e) {
        console.error("BLE Native Module not found:", e);
        return null;
      }
    }
    return null;
  });

  const injectJS = (jsCode) => {
    blocklyRef.current?.injectJavaScript(jsCode);
  };

  // ── Asset loading ────────────────────────────────────────────────────
  const [assets] = useAssets([
    require('./assets/blockly/index.html'),  // assets[0] → Blockly
    require('./assets/blockly/train.html'),  // assets[1] → Training
  ]);

  // ── Setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        NavigationBar.setVisibilityAsync("hidden");
      }
      if (Platform.OS !== "web") {
        ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.LANDSCAPE
        ).catch(() => { });
        startUsbService();
      }
    })();

    // ── Web: listen for postMessage from both iframes ──────────────────
    const webListener = (event) => {
      try {
        const msg = typeof event.data === 'string'
          ? JSON.parse(event.data)
          : event.data;

        // Blockly → open training screen
        if (msg.type === "OPEN_AI_TRAIN") {
          setShowAIScreen(true);
        }

        // Training screen → close and go back to Blockly
        if (msg.type === "CLOSE_AI_TRAIN") {
          setShowAIScreen(false);
        }

        // Training screen → relay trained classes into Blockly iframe
        if (msg.type === "AI_MODEL_TRAINED") {
          const blocklyIframe = document.querySelector(
            'iframe[title="Blockly Workspace"]'
          );
          if (blocklyIframe?.contentWindow) {
            blocklyIframe.contentWindow.postMessage(
              JSON.stringify(msg), '*'
            );
          }
        }

      } catch (e) { }
    };

    if (Platform.OS === "web") {
      window.addEventListener("message", webListener);
    }

    return () => {
      if (Platform.OS === "android") stopUsbService();
      if (Platform.OS === "web") {
        window.removeEventListener("message", webListener);
      }
    };
  }, []);

  // ── BLE ──────────────────────────────────────────────────────────────
  const scanAndConnectBLE = () => {
    if (!bleManager) return;
    injectJS(`handleBoardMessage("Searching for ESP32 Robot...");`);

    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        injectJS(`handleBoardMessage("Scan Error: ${error.message}");`);
        return;
      }
      if (device.name && device.name.includes("ESP32")) {
        bleManager.stopDeviceScan();
        device.connect()
          .then(d => d.discoverAllServicesAndCharacteristics())
          .then(d => {
            setConnectedDevice(d);
            injectJS(`handleBoardMessage("Connected to ${d.name}! ✅");`);
          })
          .catch(e =>
            injectJS(`handleBoardMessage("Error: ${e.message}");`)
          );
      }
    });
  };

  const sendToBoardBLE = async (codeString) => {
    if (!connectedDevice) {
      Alert.alert("Error", "Connect Bluetooth first!");
      return;
    }
    try {
      const chunkSize = 20;
      const totalChunks = Math.ceil(codeString.length / chunkSize);
      const writeChunk = async (str) => {
        const b64 = base64.encode(str);
        await connectedDevice.writeCharacteristicWithResponseForService(
          SERVICE_UUID, WRITE_UUID, b64
        );
      };
      await writeChunk("@@START\n");
      for (let i = 0, count = 0; i < codeString.length; i += chunkSize, count++) {
        await writeChunk(codeString.substring(i, i + chunkSize));
        const pct = Math.round((count / totalChunks) * 100);
        injectJS(`handleBoardMessage("Uploading: ${pct}%");`);
      }
      await writeChunk("\n@@END");
      injectJS(`handleBoardMessage("Upload Complete! 🚀");`);
    } catch (error) {
      injectJS(`handleBoardMessage("Upload Failed: ${error.message}");`);
    }
  };

  // ── Native WebView message bridge (Blockly) ──────────────────────────
  const handleBlocklyMessage = useCallback((event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      if (msg.type === "CONNECT_BLE") scanAndConnectBLE();
      else if (msg.type === "SEND_DATA") sendToBoardBLE(msg.data);
      else if (msg.type === "python_upload") sendToBoardUSB(buildPycodeMessage(msg.code));
      else if (msg.type === "OPEN_AI_TRAIN") setShowAIScreen(true);
      else if (msg.type === "AI_MODEL_TRAINED") {
        // relay back into Blockly WebView
        blocklyRef.current?.injectJavaScript(`
          window.dispatchEvent(new MessageEvent('message', {
            data: ${JSON.stringify(JSON.stringify(msg))}
          }));
          true;
        `);
      }
    } catch (e) {
      console.warn("Blockly Bridge Error", e);
    }
  }, [connectedDevice, bleManager]);

  // ── Native WebView message bridge (Train) ────────────────────────────
  const handleTrainMessage = useCallback((event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      if (msg.type === "CLOSE_AI_TRAIN") {
        setShowAIScreen(false);
      }

      if (msg.type === "AI_MODEL_TRAINED") {
        // relay into Blockly WebView then close train screen
        blocklyRef.current?.injectJavaScript(`
          window.dispatchEvent(new MessageEvent('message', {
            data: ${JSON.stringify(JSON.stringify(msg))}
          }));
          true;
        `);
        setShowAIScreen(false);
      }

    } catch (e) {
      console.warn("Train Bridge Error", e);
    }
  }, []);

  // ── Loading guard ────────────────────────────────────────────────────
  if (!assets || !assets[0] || !assets[1]) {
    return <View style={{ flex: 1, backgroundColor: '#cfeff2' }} />;
  }

  // ══════════════════════════════════════════════════════════════════════
  // WEB RENDER
  // ══════════════════════════════════════════════════════════════════════
  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1 }}>
        <StatusBar hidden />

        {/* ── Training iframe — full screen overlay ── */}
        {showAIScreen && (
          <iframe
            src={assets[1].uri}
            allow="camera; microphone"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: 'none',
              zIndex: 10,
            }}
            title="Model Training"
          />
        )}

        {/* ── Blockly iframe — always mounted, hidden when training ── */}
        <iframe
          src={assets[0].uri}
          allow="camera; microphone"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            visibility: showAIScreen ? 'hidden' : 'visible',
          }}
          title="Blockly Workspace"
        />
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // NATIVE RENDER (Android / iOS)
  // ══════════════════════════════════════════════════════════════════════
  return (
    <View style={{ flex: 1 }}>
      <StatusBar hidden />

      {/* ── Training WebView — shown on top when active ── */}
      {showAIScreen && (
        <WebView
          ref={trainRef}
          source={{ uri: assets[1].uri }}
          originWhitelist={["*"]}
          allowFileAccess
          allowUniversalAccessFromFileURLs
          mediaCapturePermissionGrantType="grant"
          javaScriptEnabled
          onMessage={handleTrainMessage}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10,
          }}
        />
      )}

      {/* ── Blockly WebView — always mounted ── */}
      <WebView
        ref={blocklyRef}
        originWhitelist={["*"]}
        source={{ uri: assets[0].uri }}
        allowFileAccess
        allowUniversalAccessFromFileURLs
        onMessage={handleBlocklyMessage}
        javaScriptEnabled
        style={{
          flex: 1,
          // hide visually but keep mounted so Blockly state is preserved
          opacity: showAIScreen ? 0 : 1,
          pointerEvents: showAIScreen ? 'none' : 'auto',
        }}
      />
    </View>
  );
}