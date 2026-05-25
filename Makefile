.PHONY: help publish publish-public publish-internal dry-run dry-run-public dry-run-internal clean-dry-run

help:
	@echo "Публикация:"
	@echo "  make publish           Опубликовать в оба registry (npmjs + Verdaccio)"
	@echo "  make publish-public    Опубликовать только в npmjs (github-ссылки)"
	@echo "  make publish-internal  Опубликовать только в Verdaccio (gitlab-ссылки)"
	@echo ""
	@echo "Сухой прогон (собирает tarball в tmp/, ничего не публикует):"
	@echo "  make dry-run-internal  Verdaccio-вариант → tmp/internal-pack/"
	@echo "  make dry-run-public    npmjs-вариант → tmp/public-pack/"
	@echo "  make dry-run           Оба"
	@echo "  make clean-dry-run     Удалить tmp/"

publish:
	node scripts/release.mjs

publish-public:
	node scripts/release.mjs --public

publish-internal:
	node scripts/release.mjs --internal

dry-run-internal:
	@rm -rf tmp/internal-pack
	@find . -maxdepth 1 -name 'etc-utils-typespec-amqp-ws-*.tgz' -delete
	node scripts/release.mjs --internal --dry-run
	@mkdir -p tmp/internal-pack
	@tar -xzf etc-utils-typespec-amqp-ws-*-internal.tgz -C tmp/internal-pack
	@rm etc-utils-typespec-amqp-ws-*-internal.tgz
	@echo ""
	@echo "Распаковано в: tmp/internal-pack/package/"

dry-run-public:
	@rm -rf tmp/public-pack
	@find . -maxdepth 1 -name 'etc-utils-typespec-amqp-ws-*.tgz' -delete
	node scripts/release.mjs --public --dry-run
	@mkdir -p tmp/public-pack
	@tar -xzf etc-utils-typespec-amqp-ws-*-public.tgz -C tmp/public-pack
	@rm etc-utils-typespec-amqp-ws-*-public.tgz
	@echo ""
	@echo "Распаковано в: tmp/public-pack/package/"

dry-run:
	@rm -rf tmp
	@find . -maxdepth 1 -name 'etc-utils-typespec-amqp-ws-*.tgz' -delete
	node scripts/release.mjs --dry-run
	@mkdir -p tmp/internal-pack tmp/public-pack
	@tar -xzf etc-utils-typespec-amqp-ws-*-internal.tgz -C tmp/internal-pack
	@tar -xzf etc-utils-typespec-amqp-ws-*-public.tgz -C tmp/public-pack
	@find . -maxdepth 1 -name 'etc-utils-typespec-amqp-ws-*.tgz' -delete
	@echo ""
	@echo "Распаковано:"
	@echo "  tmp/internal-pack/package/  (Verdaccio, gitlab-ссылки)"
	@echo "  tmp/public-pack/package/    (npmjs, github-ссылки)"

clean-dry-run:
	rm -rf tmp
	@find . -maxdepth 1 -name 'etc-utils-typespec-amqp-ws-*.tgz' -delete
