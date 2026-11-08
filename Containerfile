# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci --ignore-scripts
COPY client/ ./
RUN npm run build

# Stage 2: Build the Go backend
FROM golang:alpine AS server-builder
WORKDIR /build/server
# Download deps first for layer caching
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /uxer ./cmd/uxer

# Stage 3: Minimal runtime image
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app

COPY --from=server-builder /uxer ./uxer
COPY --from=frontend-builder /build/client/dist ./client/dist

# SQLite data directory
RUN mkdir -p data && chown -R nobody:nobody /app
USER nobody

EXPOSE 8080
ENV UXER_PORT=8080 \
    UXER_DB_PATH=data/uxer.db \
    UXER_STATIC_DIR=client/dist \
    UXER_ENV=production

VOLUME ["/app/data"]
ENTRYPOINT ["/app/uxer"]
