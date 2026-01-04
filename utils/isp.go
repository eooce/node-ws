package utils

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// ISPInfo holds ISP information
type ISPInfo struct {
	ISP string
}

// GetISP retrieves ISP information from ip.sb or ip-api.com
func GetISP() string {
	client := &http.Client{Timeout: 3 * time.Second}

	// Try ip.sb first
	req, _ := http.NewRequest("GET", "https://api.ip.sb/geoip", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := client.Do(req)
	if err == nil {
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err == nil {
			var data map[string]interface{}
			if json.Unmarshal(body, &data) == nil {
				if countryCode, ok := data["country_code"].(string); ok {
					if isp, ok := data["isp"].(string); ok {
						return strings.ReplaceAll(countryCode+"-"+isp, " ", "_")
					}
				}
			}
		}
	}

	// Fallback to ip-api.com
	req2, _ := http.NewRequest("GET", "http://ip-api.com/json", nil)
	req2.Header.Set("User-Agent", "Mozilla/5.0")

	resp2, err := client.Do(req2)
	if err == nil {
		defer resp2.Body.Close()
		body, err := io.ReadAll(resp2.Body)
		if err == nil {
			var data map[string]interface{}
			if json.Unmarshal(body, &data) == nil {
				if countryCode, ok := data["countryCode"].(string); ok {
					if org, ok := data["org"].(string); ok {
						return strings.ReplaceAll(countryCode+"-"+org, " ", "_")
					}
				}
			}
		}
	}

	return "Unknown"
}
