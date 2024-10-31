# Global build variables
DOCKER_REGISTRY := your-dockerhub-username
GIT_SHA := $(shell git rev-parse --short HEAD)
BUILD_DATE := $(shell date -u '+%Y-%m-%d_%H:%M:%S')
PLATFORM := linux/amd64

# List of all services
SERVICES := caddy livekit api controlserver app website webserver

# Build args for Docker
DOCKER_BUILD_ARGS := \
	--build-arg GIT_COMMIT=$(GIT_SHA) \
	--build-arg BUILD_DATE=$(BUILD_DATE) \
	--platform $(PLATFORM)

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
		docker buildx build $(DOCKER_BUILD_ARGS) \
			--platform $(PLATFORM) \
			--tag $(DOCKER_REGISTRY)/$@:$(GIT_SHA) \
			--tag $(DOCKER_REGISTRY)/$@:testing \
			--load ./$@ || exit 1; \
	fi

# Clean all build artifacts
clean:
	@for service in $(SERVICES); do \
		if [ -f $$service/Makefile ]; then \
			$(MAKE) -C $$service clean; \
		fi; \
		docker rmi -f $(DOCKER_REGISTRY)/$$service:$(GIT_SHA) 2>/dev/null || true; \
	done 