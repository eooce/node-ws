package handlers

import (
	"bytes"
	"encoding/hex"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// wsReader wraps websocket to implement io.Reader
type wsReader struct {
	ws *websocket.Conn
}

func (r *wsReader) Read(p []byte) (n int, err error) {
	_, msg, err := r.ws.ReadMessage()
	if err != nil {
		return 0, err
	}
	return copy(p, msg), nil
}

// wsWriter wraps websocket to implement io.Writer
type wsWriter struct {
	ws *websocket.Conn
}

func (w *wsWriter) Write(p []byte) (n int, err error) {
	err = w.ws.WriteMessage(websocket.BinaryMessage, p)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}

// HandleWebSocket handles WebSocket upgrade and protocol detection
func HandleWebSocket(w http.ResponseWriter, r *http.Request, wsPath, uuid string) {
	// Check path
	expectedPath := "/" + wsPath
	if !strings.HasPrefix(r.URL.Path, expectedPath) {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	// Upgrade to WebSocket
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer ws.Close()

	// Read first message for protocol detection
	_, msg, err := ws.ReadMessage()
	if err != nil {
		return
	}

	// Protocol detection
	// VLESS: version byte 0 + 16 bytes UUID
	if len(msg) > 17 && msg[0] == 0 {
		receivedUUID := msg[1:17]
		expectedUUID, err := hex.DecodeString(strings.ReplaceAll(uuid, "-", ""))
		if err == nil && bytes.Equal(receivedUUID, expectedUUID) {
			if HandleVLESS(ws, msg, uuid) {
				return
			}
		}
	}

	// Trojan: 56 bytes SHA224 hash
	if len(msg) >= 58 {
		if HandleTrojan(ws, msg, uuid) {
			return
		}
	}

	// Shadowsocks: ATYP byte (0x01, 0x03, 0x04)
	if len(msg) > 0 && (msg[0] == 0x01 || msg[0] == 0x03 || msg[0] == 0x04) {
		if HandleShadowsocks(ws, msg) {
			return
		}
	}

	// Unknown protocol, close connection
	ws.Close()
}
