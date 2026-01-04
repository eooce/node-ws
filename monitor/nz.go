package monitor

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// GetDownloadURL returns the appropriate Nezha agent download URL based on architecture
func GetDownloadURL(nezhaPort string) string {
	arch := runtime.GOARCH
	
	// Determine if it's v1 or v0 based on whether NEZHA_PORT is set
	isV1 := nezhaPort == ""
	
	if arch == "arm" || arch == "arm64" {
		if isV1 {
			return "https://arm64.ssss.nyc.mn/v1"
		}
		return "https://arm64.ssss.nyc.mn/agent"
	}
	
	// amd64
	if isV1 {
		return "https://amd64.ssss.nyc.mn/v1"
	}
	return "https://amd64.ssss.nyc.mn/agent"
}

// DownloadAgent downloads the Nezha agent binary
func DownloadAgent(nezhaPort string) error {
	url := GetDownloadURL(nezhaPort)
	
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("failed to download: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status: %d", resp.StatusCode)
	}
	
	// Create file
	file, err := os.Create("npm")
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer file.Close()
	
	// Copy content
	_, err = io.Copy(file, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}
	
	// Make executable
	if err := os.Chmod("npm", 0755); err != nil {
		return fmt.Errorf("failed to chmod: %w", err)
	}
	
	fmt.Println("npm download successfully")
	return nil
}

// IsRunning checks if Nezha agent is already running
func IsRunning() bool {
	cmd := exec.Command("sh", "-c", "ps aux | grep -v \"grep\" | grep \"./[n]pm\"")
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(output)) != ""
}

// GenerateConfigV1 generates config.yaml for Nezha v1
func GenerateConfigV1(server, key, uuid string, tlsPorts []string) error {
	port := ""
	if strings.Contains(server, ":") {
		parts := strings.Split(server, ":")
		port = parts[len(parts)-1]
	}
	
	useTLS := "false"
	for _, tlsPort := range tlsPorts {
		if port == tlsPort {
			useTLS = "true"
			break
		}
	}
	
	config := fmt.Sprintf(`client_secret: %s
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: %s
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: %s
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: %s`, key, server, useTLS, uuid)
	
	return os.WriteFile("config.yaml", []byte(config), 0644)
}

// Start starts the Nezha agent
func Start(server, port, key, uuid string) error {
	// Check if already running
	if IsRunning() {
		fmt.Println("npm is already running, skip running...")
		return nil
	}
	
	// Download agent
	if err := DownloadAgent(port); err != nil {
		return fmt.Errorf("failed to download agent: %w", err)
	}
	
	tlsPorts := []string{"443", "8443", "2096", "2087", "2083", "2053"}
	
	var cmd *exec.Cmd
	
	// Nezha v0 (with NEZHA_PORT)
	if server != "" && port != "" && key != "" {
		useTLS := ""
		for _, tlsPort := range tlsPorts {
			if port == tlsPort {
				useTLS = "--tls"
				break
			}
		}
		
		cmdStr := fmt.Sprintf("nohup ./npm -s %s:%s -p %s %s --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &", 
			server, port, key, useTLS)
		cmd = exec.Command("sh", "-c", cmdStr)
		
	// Nezha v1 (without NEZHA_PORT)
	} else if server != "" && key != "" {
		if err := GenerateConfigV1(server, key, uuid, tlsPorts); err != nil {
			return fmt.Errorf("failed to generate config: %w", err)
		}
		
		cmdStr := "nohup ./npm -c config.yaml >/dev/null 2>&1 &"
		cmd = exec.Command("sh", "-c", cmdStr)
	} else {
		return nil
	}
	
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start npm: %w", err)
	}
	
	fmt.Println("npm is running")
	return nil
}

// Cleanup removes Nezha agent files after a delay
func Cleanup(delay time.Duration) {
	time.Sleep(delay)
	
	files := []string{"npm", "config.yaml"}
	for _, file := range files {
		os.Remove(file)
	}
}
