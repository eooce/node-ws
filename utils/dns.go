package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

var dnsServers = []string{"8.8.4.4", "1.1.1.1"}

// DNSResponse represents Google DNS-over-HTTPS response
type DNSResponse struct {
	Status int `json:"Status"`
	Answer []struct {
		Type int    `json:"type"`
		Data string `json:"data"`
	} `json:"Answer"`
}

// ResolveHost resolves a hostname to an IP address using Google DNS-over-HTTPS
func ResolveHost(host string) (string, error) {
	// Check if already an IP address
	if net.ParseIP(host) != nil {
		return host, nil
	}

	client := &http.Client{Timeout: 5 * time.Second}

	// Try each DNS server
	for range dnsServers {
		dnsQuery := fmt.Sprintf("https://dns.google/resolve?name=%s&type=A", host)

		resp, err := client.Get(dnsQuery)
		if err != nil {
			continue
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			continue
		}

		var dnsResp DNSResponse
		if err := json.Unmarshal(body, &dnsResp); err != nil {
			continue
		}

		if dnsResp.Status == 0 && len(dnsResp.Answer) > 0 {
			for _, answer := range dnsResp.Answer {
				if answer.Type == 1 { // A record
					return answer.Data, nil
				}
			}
		}
	}

	// Fallback to system DNS
	ips, err := net.LookupIP(host)
	if err != nil {
		return "", fmt.Errorf("failed to resolve %s: %w", host, err)
	}

	for _, ip := range ips {
		if ipv4 := ip.To4(); ipv4 != nil {
			return ipv4.String(), nil
		}
	}

	return "", fmt.Errorf("no IPv4 address found for %s", host)
}