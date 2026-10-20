import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:8787";
let server;
let browser;
let serverLog = "";
const isServing = async () => {
  try {
    return (await fetch(baseURL)).ok;
  } catch {
    return false;
  }
};

try {
  if (!(await isServing())) {
    server = spawn("npm", ["run", "dev"], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (chunk) => {
        serverLog += chunk;
      });
    const deadline = Date.now() + 45000;
    while (!(await isServing())) {
      if (Date.now() > deadline || server.exitCode !== null)
        throw new Error(`Servidor não iniciou:\n${serverLog}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const executablePath =
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });
  const errors = [];
  const failures = [];
  const utmifyUrl = "https://cdn.utmify.com.br/scripts/utms/latest.js";
  const utmifyPixelUrl = "https://cdn.utmify.com.br/scripts/pixel/pixel.js";
  const metaTransportUrl = "https://www.facebook.com/tr/";
  const metaGateways = [
    "https://md-eecad2978f7a43f5b7838c919258e6de.ecs.us-east-2.on.aws/events",
    "https://bded8a3c6ae-1-1053047382554.us-central1.run.app/events",
  ];
  const attachChecks = async (page) => {
    for (const url of metaGateways) {
      await page.route(url, (route) => route.fulfill({ status: 204 }));
    }
    await page.route(metaTransportUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Meta transport intercepted</title>",
      }),
    );
    for (const host of ["api.ipify.org", "api6.ipify.org"]) {
      await page.route(`https://${host}/**`, (route) =>
        route.fulfill({
          contentType: "application/json",
          body: "{}",
        }),
      );
    }
    await page.route(utmifyPixelUrl, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `
          window.__loadedPixelId = window.pixelId;
          const dependencies = [
            "https://api.ipify.org/?format=json",
            "https://api6.ipify.org/?format=json",
            ...${JSON.stringify(metaGateways)},
          ];
          Promise.all(dependencies.map(url => fetch(url).then(response => {
            if (!response.ok) throw new Error("Pixel transport blocked");
          }))).then(() => {
            window.__pixelDependenciesReady = true;
            const iframe = document.createElement("iframe");
            iframe.name = "meta-transport-test";
            iframe.hidden = true;
            document.body.append(iframe);
            const form = document.createElement("form");
            form.action = "${metaTransportUrl}";
            form.method = "POST";
            form.target = iframe.name;
            for (const [name, value] of Object.entries({id: "1120233877382323", ev: "PageView"})) {
              const input = document.createElement("input");
              input.type = "hidden";
              input.name = name;
              input.value = value;
              form.append(input);
            }
            document.body.append(form);
            form.submit();
          });
        `,
      }),
    );
    // Isolate third-party delivery while checking browser CSP and script ordering.
    await page.route(utmifyUrl, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'window.__utmifyReady = { links: Array.from(document.querySelectorAll("[data-checkout]"), el => el.href) };',
      }),
    );
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400)
        failures.push(`${response.status()} ${response.url()}`);
    });
  };
  const useEmptyConfig = (page) =>
    page.route("**/config.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'window.SITE_CONFIG={checkoutUrl:"",utmifyPixelId:"",siteUrl:""}',
      }),
    );
  await mkdir(".wrangler/screenshots", { recursive: true });

  for (const [width, height] of [
    [320, 568],
    [360, 640],
    [375, 667],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1440, 1000],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await attachChecks(page);
    await useEmptyConfig(page);
    await page.goto(baseURL);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("main").count(), 1);
    assert.equal(
      await page.locator("main>section, main>.hero-shell>section").count(),
      3,
    );
    assert.equal(await page.locator("[data-checkout]").count(), 2);
    assert.equal(await page.locator(".content-card").count(), 3);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      ctaBottom: document
        .querySelector("[data-checkout]")
        .getBoundingClientRect().bottom,
    }));
    assert.equal(layout.overflow, false, `Sem overflow em ${width}px`);
    if (width >= 360 && width <= 430)
      assert.ok(
        layout.ctaBottom <= height,
        `CTA deve caber na primeira tela de ${width}×${height}: ${layout.ctaBottom}`,
      );
    for (const image of await page.locator("main img").all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((img) => img.decode());
      assert.ok(await image.evaluate((img) => img.naturalWidth > 0));
    }
    if (width === 390 || width === 1440) {
      await page.screenshot({
        path: `.wrangler/screenshots/${width}.png`,
        fullPage: true,
      });
    }
    console.log(`✓ Layout, conteúdo e imagens: ${width}×${height}`);
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await attachChecks(page);
  await useEmptyConfig(page);
  const remoteRequests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(baseURL) && request.url() !== utmifyUrl)
      remoteRequests.push(request.url());
  });
  await page.goto(baseURL);
  for (const button of await page.locator("[data-checkout]").all()) {
    await button.click();
    await page.locator("#checkout-notice").waitFor({ state: "visible" });
    assert.equal(page.url(), `${baseURL}/`);
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(
    remoteRequests,
    [],
    "Nenhum Meta Pixel carregado sem configuração",
  );
  console.log(
    "✓ Checkout ausente informa indisponibilidade, sem cobrança ou rastreamento",
  );

  for (let index = 0; index < 3; index++) {
    const trigger = page.locator(`[data-gallery="${index}"]`);
    await trigger.click();
    assert.equal(
      await page.locator("#gallery-count").textContent(),
      `${index + 1} / 3`,
    );
    await page.locator(".gallery-zoom").click();
    assert.equal(
      await page.locator(".gallery-zoom").getAttribute("aria-pressed"),
      "true",
    );
    assert.ok(
      await page
        .locator(".gallery-image-wrap")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    );
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#gallery-count").textContent(),
      `${((index + 1) % 3) + 1} / 3`,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await trigger.evaluate((el) => el === document.activeElement),
      true,
    );
  }
  for (const details of await page.locator(".faq details").all()) {
    await details.locator("summary").click();
    assert.equal(await details.getAttribute("open"), "");
    assert.equal(await details.locator("p").isVisible(), true);
  }
  console.log("✓ Galeria, ampliação, navegação por teclado, foco e FAQ");
  await page.close();

  const configured = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await attachChecks(configured);
  await configured.route("https://pay.cakto.com.br/3eucwcb_1220399", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Destino interceptado pelo teste</title>",
    }),
  );
  for (const location of ["hero", "offer"]) {
    const metaPost = configured.waitForRequest(
      (request) =>
        request.url() === metaTransportUrl && request.method() === "POST",
    );
    await configured.goto(baseURL);
    await configured.waitForFunction(
      () => window.__loadedPixelId === "6ad7b085f5cbd7dbf00a1e8a",
    );
    await configured.waitForFunction(() => !!window.__utmifyReady);
    await configured.waitForFunction(
      () => window.__pixelDependenciesReady === true,
    );
    const metaPayload = new URLSearchParams((await metaPost).postData());
    assert.equal(metaPayload.get("id"), "1120233877382323");
    assert.equal(metaPayload.get("ev"), "PageView");
    assert.equal(
      await configured.locator(`script[src="${utmifyPixelUrl}"]`).count(),
      1,
    );
    assert.equal(
      await configured
        .locator('script[src*="fbevents.js"], .meta-pixel-fallback')
        .count(),
      0,
    );
    assert.equal(
      await configured.evaluate(() => typeof window.fbq),
      "undefined",
    );
    assert.equal(
      await configured
        .locator(`script[src="${utmifyPixelUrl}"]`)
        .evaluate((el) => el.async && el.defer),
      true,
    );
    assert.deepEqual(
      await configured.evaluate(() => window.__utmifyReady.links),
      [
        "https://pay.cakto.com.br/3eucwcb_1220399",
        "https://pay.cakto.com.br/3eucwcb_1220399",
      ],
    );
    const utmifyScript = configured.locator(`script[src="${utmifyUrl}"]`);
    assert.equal(await utmifyScript.count(), 1);
    for (const attribute of [
      "data-utmify-prevent-xcod-sck",
      "data-utmify-prevent-subids",
      "defer",
    ]) {
      assert.equal(await utmifyScript.getAttribute(attribute), "");
    }
    assert.equal(
      await configured
        .locator(`[data-checkout="${location}"]`)
        .getAttribute("href"),
      "https://pay.cakto.com.br/3eucwcb_1220399",
    );
    await configured.locator(`[data-checkout="${location}"]`).click();
    await configured.waitForURL("https://pay.cakto.com.br/3eucwcb_1220399");
  }
  console.log(
    "✓ Ambos os CTAs apontam para Cakto e o novo pixel UTMify recebe o ID fornecido",
  );
  console.log(
    "✓ CSP permite os gateways da Meta e o transporte alternativo por formulário, com destinos interceptados",
  );
  console.log(
    "✓ UTMify permitida pelo CSP e carregada depois de configurar os links, com os atributos fornecidos",
  );

  await configured.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.SITE_CONFIG={checkoutUrl:"javascript:alert(1)",utmifyPixelId:"invalid"}',
    }),
  );
  await configured.goto(baseURL);
  await configured.locator('[data-checkout="hero"]').click();
  assert.equal(await configured.locator("#checkout-notice").isVisible(), true);
  console.log("✓ URL de checkout inválida é rejeitada");

  const response = await fetch(baseURL);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(
    response.headers
      .get("content-security-policy")
      ?.includes("object-src 'none'"),
  );
  assert.deepEqual(errors, [], "Sem erros de JavaScript");
  assert.deepEqual(failures, [], "Sem respostas HTTP de erro");
  console.log("✓ Cabeçalhos e execução sem erros. Todos os testes passaram.");
} finally {
  await browser?.close();
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      /* Processo já encerrado. */
    }
  }
}
