package utils

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"
)

// AddAccessTask adds the subscription URL to the keep-alive service
func AddAccessTask(domain, subPath string) error {
	if domain == "" {
		return nil
	}

	fullURL := "https://" + domain + "/" + subPath

	payload := map[string]string{
		"url": fullURL,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(
		"https://oooo.serv00.net/add-url",
		"application/json",
		bytes.NewBuffer(jsonData),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}
