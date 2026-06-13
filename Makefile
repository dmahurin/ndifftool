NEU ?= neu

.PHONY: all check bootstrap update ensure-assets build run serve clean distclean help

all: build

check:
	@command -v $(NEU) >/dev/null 2>&1 || { \
		echo "Neutralino CLI not found: $(NEU)"; \
		echo "Install it with: npm install -g @neutralinojs/neu"; \
		exit 1; \
	}

bootstrap: check update

update: check
	$(NEU) update

ensure-assets: check
	@if [ ! -d bin ] || [ ! -f resources/neutralino.js ]; then \
		echo "Neutralino runtime assets missing; running '$(NEU) update'..."; \
		$(NEU) update; \
	fi

build: ensure-assets
	$(NEU) build --release

run: ensure-assets
	$(NEU) run

serve: ensure-assets
	$(NEU) run -- --window-enable-inspector

clean:
	rm -rf dist

distclean: clean
	rm -rf bin extensions resources/neutralino.js

help:
	@echo "Targets:"
	@echo "  make bootstrap  Download Neutralino runtime and client assets"
	@echo "  make build      Build a release package in dist/"
	@echo "  make run        Run the app in development mode"
	@echo "  make serve      Run with the inspector enabled"
	@echo "  make clean      Remove release artifacts"
	@echo "  make distclean  Remove generated Neutralino assets too"
