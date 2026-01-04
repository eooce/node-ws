package utils

import (
	"io"
	"net/http"
	"strings"
	"time"
)

// IPInfo holds IP detection results
type IPInfo struct {
	Domain string
	TLS    string
	Port   int
}

// GetIP retrieves public IP address and determines connection settings
func GetIP(domain string, port int) *IPInfo {
	if domain == "" || domain == "your-domain.com" {
		// Try to get public IP
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Get("https://api-ipv4.ip.sb/ip")
		if err == nil {
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err == nil {
				ip := strings.TrimSpace(string(body))
				return &IPInfo{
					Domain: ip,
					TLS:    "none",
					Port:   port,
				}
			}
		}

		// Fallback
		return &IPInfo{
			Domain: "change-your-domain.com",
			TLS:    "tls",
			Port:   443,
		}
	}

	return &IPInfo{
		Domain: domain,
		TLS:    "tls",
		Port:   443,
	}
}
