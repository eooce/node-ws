package handlers

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"gows/utils"
	"io"
	"net"
	"strings"

	"github.com/gorilla/websocket"
)

// HandleTrojan handles Trojan-WS protocol connections
func HandleTrojan(ws *websocket.Conn, msg []byte, uuid string) bool {
	if len(msg) < 58 {
		return false
	}

	// Validate password hash (56 bytes SHA224)
	receivedHash := string(msg[0:56])

	// Calculate expected hash
	hash := sha256.Sum224([]byte(uuid))
	expectedHash := hex.EncodeToString(hash[:])

	if receivedHash != expectedHash {
		return false
	}

	offset := 56

	// Skip CRLF if present
	if offset+1 < len(msg) && msg[offset] == 0x0d && msg[offset+1] == 0x0a {
		offset += 2
	}

	// Check command (should be 0x01 for CONNECT)
	if offset >= len(msg) || msg[offset] != 0x01 {
		return false
	}
	offset++

	// Parse address type
	if offset >= len(msg) {
		return false
	}
	atyp := msg[offset]
	offset++

	var host string

	switch atyp {
	case 0x01: // IPv4
		if len(msg) < offset+4 {
			return false
		}
		host = fmt.Sprintf("%d.%d.%d.%d", msg[offset], msg[offset+1], msg[offset+2], msg[offset+3])
		offset += 4

	case 0x03: // Domain
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

	case 0x04: // IPv6
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

	// Parse port
	if len(msg) < offset+2 {
		return false
	}
	port := binary.BigEndian.Uint16(msg[offset : offset+2])
	offset += 2

	// Skip CRLF if present
	if offset+1 < len(msg) && msg[offset] == 0x0d && msg[offset+1] == 0x0a {
		offset += 2
	}

	// Check if domain is blocked
	if utils.IsBlockedDomain(host) {
		ws.Close()
		return false
	}

	// Resolve host
	resolvedIP, err := utils.ResolveHost(host)
	if err != nil {
		resolvedIP = host
	}

	// Connect to target
	targetAddr := fmt.Sprintf("%s:%d", resolvedIP, port)
	conn, err := net.Dial("tcp", targetAddr)
	if err != nil {
		ws.Close()
		return false
	}
	defer conn.Close()

	// Write remaining data
	if offset < len(msg) {
		conn.Write(msg[offset:])
	}

	// Bidirectional forwarding
	go io.Copy(conn, &wsReader{ws})
	io.Copy(&wsWriter{ws}, conn)

	return true
}
