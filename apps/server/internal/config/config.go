package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	Port           string
	DatabaseURL    string
	AllowedOrigins map[string]struct{}
}

func Load() (Config, error) {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}

	originsValue := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if originsValue == "" {
		originsValue = "http://localhost:5173"
	}

	origins := make(map[string]struct{})
	for _, origin := range strings.Split(originsValue, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins[origin] = struct{}{}
		}
	}

	return Config{
		Port:           port,
		DatabaseURL:    databaseURL,
		AllowedOrigins: origins,
	}, nil
}
