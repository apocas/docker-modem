node_modules: package.json
	npm install

.PHONY: test
test: node_modules
	./node_modules/.bin/mocha $(wildcard lib/*_test.js)
