# Global build variables
GIT_SHA := $(shell git rev-parse --short HEAD)
BUILD_DATE := $(shell date -u '+%Y-%m-%d_%H:%M:%S')

# List of all services
SERVICES := caddy livekit api controlserver app website webserver

.PHONY: all build clean $(SERVICES)

# Default target
all: build

# Build all services
build: $(SERVICES)

# Generic target for services
$(SERVICES):
	@echo "Building $@ service..."
	@if [ -f $@/Makefile ]; then \
		$(MAKE) -C $@ build || exit 1; \
	else \
		docker build \
			--build-arg GIT_COMMIT=$(GIT_SHA) \
			--build-arg BUILD_DATE=$(BUILD_DATE) \
			-t peekaview/$@:$(GIT_SHA) \
			-t peekaview/$@:testing \
			-t peekaview/$@ \
			./$@ || exit 1; \
	fi

# Clean all build artifacts
clean:
	@for service in $(SERVICES); do \
		if [ -f $$service/Makefile ]; then \
			$(MAKE) -C $$service clean; \
		fi; \
		docker rmi -f $$service:$(GIT_SHA) 2>/dev/null || true; \
	done 