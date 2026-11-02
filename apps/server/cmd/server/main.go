package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rahulgope45/converge/apps/server/internal/config"
	"github.com/rahulgope45/converge/apps/server/internal/httpapi"
	"github.com/rahulgope45/converge/apps/server/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	configuration, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	dataStore, err := store.Open(ctx, configuration.DatabaseURL)
	if err != nil {
		logger.Error("open store", "error", err)
		os.Exit(1)
	}
	defer dataStore.Close()

	server := &http.Server{
		Addr:              ":" + configuration.Port,
		Handler:           httpapi.New(dataStore, configuration.AllowedOrigins, logger),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		logger.Info("server started", "address", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("serve HTTP", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		logger.Error("shutdown server", "error", err)
	}
	logger.Info("server stopped")
}
