package utils

import "strings"

var blockedDomains = []string{
	"speedtest.net", "fast.com", "speedtest.cn", "speed.cloudflare.com", "speedof.me",
	"testmy.net", "bandwidth.place", "speed.io", "librespeed.org", "speedcheck.org",
}

// IsBlockedDomain checks if a host is in the blocked domains list
func IsBlockedDomain(host string) bool {
	if host == "" {
		return false
	}
	hostLower := strings.ToLower(host)
	for _, blocked := range blockedDomains {
		if hostLower == blocked || strings.HasSuffix(hostLower, "."+blocked) {
			return true
		}
	}
	return false
}
