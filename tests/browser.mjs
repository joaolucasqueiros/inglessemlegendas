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
  const attachChecks = (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400)
        failures.push(`${response.status()} ${response.url()}`);
    });
  };
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
    attachChecks(page);
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
  attachChecks(page);
  const remoteRequests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(baseURL)) remoteRequests.push(request.url());
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
    "Nenhum rastreamento/recurso externo sem configuração",
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
  attachChecks(configured);
  const pixelEvents = [];
  configured.on("console", (message) => {
    if (message.text().startsWith("TEST_PIXEL:"))
      pixelEvents.push(JSON.parse(message.text().slice(11)));
  });
  await configured.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.SITE_CONFIG={checkoutUrl:"https://checkout.example.test/ebook",metaPixelId:"123456789012345",siteUrl:"https://ingles.example.test/"}',
    }),
  );
  await configured.route(
    "https://connect.facebook.net/en_US/fbevents.js",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'fbq.callMethod=function(){console.log("TEST_PIXEL:"+JSON.stringify(Array.from(arguments)))};fbq.queue.forEach(args=>fbq.callMethod.apply(null,args));',
      }),
  );
  await configured.route("https://checkout.example.test/ebook", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Destino interceptado pelo teste</title>",
    }),
  );
  for (const location of ["hero", "offer"]) {
    await configured.goto(baseURL);
    await configured.waitForFunction(
      () => typeof window.fbq?.callMethod === "function",
    );
    assert.equal(
      await configured
        .locator(`[data-checkout="${location}"]`)
        .getAttribute("href"),
      "https://checkout.example.test/ebook",
    );
    await configured.locator(`[data-checkout="${location}"]`).click();
    await configured.waitForURL("https://checkout.example.test/ebook");
  }
  assert.equal(
    pixelEvents.filter((event) => event[1] === "PageView").length,
    2,
  );
  const checkoutEvents = pixelEvents.filter(
    (event) => event[1] === "InitiateCheckout",
  );
  assert.equal(checkoutEvents.length, 2);
  assert.equal(checkoutEvents[0][2].value, 19.9);
  assert.equal(checkoutEvents[0][2].currency, "BRL");
  console.log(
    "✓ Ambos os CTAs usam a URL configurada; PageView e InitiateCheckout validados com rede interceptada",
  );

  await configured.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.SITE_CONFIG={checkoutUrl:"javascript:alert(1)",metaPixelId:"invalid"}',
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
