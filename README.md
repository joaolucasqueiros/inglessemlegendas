# Inglês Sem Legendas

Landing page em HTML, CSS e JavaScript, com imagens locais e hospedagem preparada para Cloudflare Workers Static Assets. Edite os arquivos em `public/`; o build gera a versão publicável em `dist/`.

## Desenvolvimento

Use Node.js 24.19.0 e npm 11.9.0. Na raiz do projeto:

```sh
npm ci
npm run dev
```

Acesse `http://localhost:8787`. O servidor escuta em `0.0.0.0:8787` para permitir a prévia do ambiente na nuvem. O modo local não exige conta ou token da Cloudflare.

O Wrangler executa `npm run build` automaticamente ao iniciar e ao detectar alterações em `public/`. Não edite `dist/`, pois é uma saída gerada e ignorada pelo Git.

Os scripts mantêm os arquivos locais de configuração e logs do Wrangler em `.wrangler/`, que está no `.gitignore`, para funcionar também quando o diretório pessoal do ambiente não permite escrita.

Se o ambiente não permitir o cache padrão do npm, instale com `npm ci --cache /tmp/codex-npm-cache`.

## Configuração da página

Edite somente os valores públicos em `public/config.js`:

```js
window.SITE_CONFIG = {
  checkoutUrl: '',
  utmifyPixelId: '',
  siteUrl: ''
};
```

- `checkoutUrl`: endereço HTTPS do checkout real. Enquanto estiver vazio, os botões de compra exibem um aviso e não abrem uma cobrança.
- `utmifyPixelId`: identificador público do pixel da UTMify. Vazio, mantém esse pixel desativado. O script da UTMify gerencia os eventos; não há inicialização paralela do antigo Meta Pixel. O script de UTMs permanece ativo separadamente.
- `siteUrl`: endereço HTTPS definitivo da página. O build coloca canonical, `og:url` e `og:image` absoluta no HTML servido, para funcionar também com robôs de compartilhamento que não executam JavaScript. Deixe vazio apenas durante a prévia local; preencha antes da publicação.

Não coloque tokens, senhas ou outros segredos nesse arquivo: seu conteúdo é público.

## Validação

```sh
npm run check
npm test
```

`check` executa `wrangler deploy --dry-run --outdir .wrangler/dry-run`: gera `dist/`, valida e prepara o pacote localmente sem publicar. Para gerar somente os arquivos estáticos, execute `npm run build`. O teste de navegador usa Playwright com Chromium; no ambiente da nuvem, o executável está em `/usr/bin/chromium`.

## Publicação

`wrangler.jsonc` executa o build e aponta para os arquivos estáticos em `dist/`. Para publicar depois da revisão, configure uma conta Cloudflare e execute `npx wrangler deploy`. Essa etapa envia o site à conta autenticada e deve ser realizada somente quando a publicação for autorizada.

Este projeto não precisa de banco de dados, variáveis secretas ou serviço de backend. O build apenas copia os arquivos e materializa os metadados; não adiciona frameworks nem pacotes de runtime.
