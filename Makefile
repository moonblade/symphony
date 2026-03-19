.PHONY: build build-ui run dev clean typecheck

build:
	npm run build

build-ui:
	npm run build:ui

run: build
	node dist/cli.js --watch

dev: build-ui
	npm run dev

typecheck:
	npm run typecheck

clean:
	rm -rf dist node_modules
