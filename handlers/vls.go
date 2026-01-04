package handlers

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"gows/utils"
	"io"
	"net"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// HandleVLESS handles VLESS-WS protocol connections
func HandleVLESS(ws *websocket.Conn, msg []byte, uuid string) bool {
	if len(msg) < 18 {
		return false
	}

	// Check version byte
	version := msg[0]
	if version != 0 {
		return false
	}

	// Validate UUID (16 bytes)
	receivedUUID := msg[1:17]
	expectedUUID, err := hex.DecodeString(strings.ReplaceAll(uuid, "-", ""))
	if err != nil || !bytes.Equal(receivedUUID, expectedUUID) {
		return false
	}

	// Parse additional options length
	optLen := int(msg[17])
	offset := 18 + optLen

	if len(msg) < offset+4 {
		return false
	}

	// Parse Command byte (usually 0x01 for TCP)
	cmd := msg[offset]
	offset++
	
	if cmd != 1 {
		return false
	}

	// Parse port (2 bytes, big-endian)
	port := binary.BigEndian.Uint16(msg[offset : offset+2])
	offset += 2

	// Parse address type
	atyp := msg[offset]
	offset++

	var host string

	switch atyp {
	case 1: // IPv4
		if len(msg) < offset+4 {
			return false
		}
		host = fmt.Sprintf("%d.%d.%d.%d", msg[offset], msg[offset+1], msg[offset+2], msg[offset+3])
		offset += 4

	case 2: // Domain
		if len(msg) < offset+1 {
			return false
		}
		domainLen := int(msg[offset])
		offset++
		if len(msg) < offset+domainLen {
			return false
		}
		host = string(msg[offset : offset+domainLen])
		offset += domainLen

	case 3: // IPv6
		if len(msg) < offset+16 {
			return false
		}
		ipv6 := msg[offset : offset+16]
		var parts []string
		for i := 0; i < 16; i += 2 {
			parts = append(parts, fmt.Sprintf("%x", binary.BigEndian.Uint16(ipv6[i:i+2])))
		}
		host = strings.Join(parts, ":")
		offset += 16

	default:
		return false
	}

	// Check if domain is blocked
	if utils.IsBlockedDomain(host) {
		ws.Close()
		return false
	}

	// Send response
	if err := ws.WriteMessage(websocket.BinaryMessage, []byte{version, 0}); err != nil {
		return false
	}

	// Resolve host
	resolvedIP, err := utils.ResolveHost(host)
	if err != nil {
		resolvedIP = host
	}

	// Connect to target with timeout
	targetAddr := fmt.Sprintf("%s:%d", resolvedIP, port)
	dialer := &net.Dialer{
		Timeout: 10 * time.Second,
	}
	conn, err := dialer.Dial("tcp", targetAddr)
	if err != nil {
		ws.Close()
		return false
	}
	defer conn.Close()

	// Write remaining data
	if offset < len(msg) {
		if _, err := conn.Write(msg[offset:]); err != nil {
			return false
		}
	}

	// Bidirectional forwarding
	errChan := make(chan error, 2)
	
	go func() {
		_, err := io.Copy(conn, &wsReader{ws})
		errChan <- err
	}()
	
	go func() {
		_, err := io.Copy(&wsWriter{ws}, conn)
		errChan <- err
	}()
	
	// Wait for either direction to complete
	<-errChan

	return true
}