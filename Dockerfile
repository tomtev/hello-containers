# syntax=docker/dockerfile:1

FROM golang:1.22-alpine AS build

WORKDIR /app

# Copy go mod and source files
COPY container_src/go.mod ./
COPY container_src/main.go ./

# Build the binary
RUN go build -o server main.go

# Final stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=build /app/server .

EXPOSE 8080

CMD ["./server"]