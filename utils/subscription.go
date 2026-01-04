package utils

import (
	"encoding/base64"
	"fmt"
	"net/url"
)

// GenerateSubscription generates subscription URLs for VLESS, Trojan, and Shadowsocks
func GenerateSubscription(uuid, domain, wsPath, name, isp string, port int, tls string) string {
	namePart := isp
	if name != "" {
		namePart = name + "-" + isp
	}

	tlsParam := "none"
	ssTlsParam := ""
	if tls == "tls" {
		tlsParam = "tls"
		ssTlsParam = "tls;"
	}

	// VLESS URL
	vlsURL := fmt.Sprintf(
		"vless://%s@%s:%d?encryption=none&security=%s&sni=%s&fp=chrome&type=ws&host=%s&path=%%2F%s#%s",
		uuid, domain, port, tlsParam, domain, domain, wsPath, url.QueryEscape(namePart),
	)

	// Trojan URL
	troURL := fmt.Sprintf(
		"trojan://%s@%s:%d?security=%s&sni=%s&fp=chrome&type=ws&host=%s&path=%%2F%s#%s",
		uuid, domain, port, tlsParam, domain, domain, wsPath, url.QueryEscape(namePart),
	)

	// Shadowsocks URL
	ssMethodPassword := base64.StdEncoding.EncodeToString([]byte("none:" + uuid))
	ssURL := fmt.Sprintf(
		"ss://%s@%s:%d?plugin=v2ray-plugin;mode%%3Dwebsocket;host%%3D%s;path%%3D%%2F%s;%ssni%%3D%s;skip-cert-verify%%3Dtrue;mux%%3D0#%s",
		ssMethodPassword, domain, port, domain, wsPath, ssTlsParam, domain, url.QueryEscape(namePart),
	)

	subscription := vlsURL + "\n" + troURL + "\n" + ssURL
	return base64.StdEncoding.EncodeToString([]byte(subscription))
}
