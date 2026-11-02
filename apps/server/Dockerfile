FROM golang:1.27-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/converge-server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/converge-server /converge-server
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/converge-server"]
