package main

import (
	"embed"
	"fmt"
	"gows/handlers"
	"gows/monitor"
	"gows/utils"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/joho/godotenv/autoload"
)

//go:embed index.html
var indexContent embed.FS

// Config holds all configuration values
type Config struct {
	UUID        string
	NezhaServer string
	NezhaPort   string
	NezhaKey    string
	Domain      string
	AutoAccess  bool
	WSPath      string
	SubPath     string
	Name        string
	Port        int
}

// LoadConfig loads configuration from environment variables
func LoadConfig() *Config {
	uuid := getEnv("UUID", "5efabea4-f6d4-91fd-b8f0-17e004c89c60")
	port, _ := strconv.Atoi(getEnv("PORT", "3000"))
	autoAccess, _ := strconv.ParseBool(getEnv("AUTO_ACCESS", "false"))

	wsPath := getEnv("WSPATH", "")
	if wsPath == "" {
		// Default to first 8 chars of UUID
		wsPath = strings.ReplaceAll(uuid, "-", "")[:8]
	}

	return &Config{
		UUID:        uuid,
		NezhaServer: getEnv("NEZHA_SERVER", ""),
		NezhaPort:   getEnv("NEZHA_PORT", ""),
		NezhaKey:    getEnv("NEZHA_KEY", ""),
		Domain:      getEnv("DOMAIN", ""),
		AutoAccess:  autoAccess,
		WSPath:      wsPath,
		SubPath:     getEnv("SUB_PATH", "sub"),
		Name:        getEnv("NAME", ""),
		Port:        port,
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

var config *Config

func main() {
	// Load configuration
	config = LoadConfig()

	// Setup HTTP routes
	http.HandleFunc("/", handleRoot)
	http.HandleFunc("/"+config.SubPath, handleSubscription)
	http.HandleFunc("/"+config.WSPath, func(w http.ResponseWriter, r *http.Request) {
		handlers.HandleWebSocket(w, r, config.WSPath, config.UUID)
	})

	// Start server
	addr := fmt.Sprintf(":%d", config.Port)
	server := &http.Server{
		Addr:         addr,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	// Handle graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
		<-sigChan
		log.Println("Shutting down server...")
		server.Close()
	}()

	// Add auto-access task if enabled
	if config.AutoAccess && config.Domain != "" {
		go func() {
			time.Sleep(2 * time.Second)
			if err := utils.AddAccessTask(config.Domain, config.SubPath); err == nil {
				log.Println("Automatic Access Task added successfully")
			}
		}()
	}

	// Start Nezha monitoring if configured
	if config.NezhaServer != "" && config.NezhaKey != "" {
		go func() {
			if err := monitor.Start(config.NezhaServer, config.NezhaPort, config.NezhaKey, config.UUID); err != nil {
				log.Printf("Failed to start Nezha agent: %v", err)
			}
		}()
		
		// Cleanup Nezha files after 3 minutes
		go monitor.Cleanup(3 * time.Minute)
	}

	log.Printf("Server is running on port %d", config.Port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	// Read embedded index.html
	content, err := indexContent.ReadFile("index.html")
	if err != nil {
		// 如果嵌入的文件不存在，使用默认页面
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<!DOCTYPE html><html><head><title>Gows</title></head><body><h1>Welcome to Gows</h1><p>Server is running!</p></body></html>"))
		return
	}

	w.Header().Set("Content-Type", "text/html")
	w.Write(content)
}

func handleSubscription(w http.ResponseWriter, r *http.Request) {
	// Get ISP and IP info
	isp := utils.GetISP()
	ipInfo := utils.GetIP(config.Domain, config.Port)

	// Generate subscription
	subscription := utils.GenerateSubscription(
		config.UUID,
		ipInfo.Domain,
		config.WSPath,
		config.Name,
		isp,
		ipInfo.Port,
		ipInfo.TLS,
	)

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(subscription + "\n"))
}