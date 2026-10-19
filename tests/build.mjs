import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite } from "../scripts/build.mjs";

const sourceHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

async function fixture(t, siteUrl = "") {
  const root = await mkdtemp(join(tmpdir(), "ingles-build-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDirectory = join(root, "public");
  const outputDirectory = join(root, "dist");
  await mkdir(join(sourceDirectory, "assets"), { recursive: true });
  const configSource = `window.SITE_CONFIG = Object.freeze(${JSON.stringify({ checkoutUrl: "", metaPixelId: "", siteUrl })});`;
  await Promise.all([
    writeFile(join(sourceDirectory, "index.html"), sourceHtml),
    writeFile(join(sourceDirectory, "config.js"), configSource),
    writeFile(join(sourceDirectory, "assets", "sample.txt"), "asset preserved"),
  ]);
  return { sourceDirectory, outputDirectory, configSource };
}

test("configuração vazia mantém a prévia local e copia arquivos sem alterar as fontes", async (t) => {
  const paths = await fixture(t);
  await buildSite(paths);
  assert.equal(await readFile(join(paths.outputDirectory, "index.html"), "utf8"), sourceHtml);
  assert.equal(await readFile(join(paths.outputDirectory, "assets", "sample.txt"), "utf8"), "asset preserved");
  assert.equal(await readFile(join(paths.outputDirectory, "config.js"), "utf8"), paths.configSource);
  assert.equal(await readFile(join(paths.sourceDirectory, "index.html"), "utf8"), sourceHtml);
  assert.equal(await readFile(join(paths.sourceDirectory, "config.js"), "utf8"), paths.configSource);
});

test("siteUrl gera metadados estáticos absolutos, escapa atributos e remove fragmentos", async (t) => {
  const paths = await fixture(t, "https://ingles.example.com/?from=share&lang=pt#oferta");
  await buildSite(paths);
  const output = await readFile(join(paths.outputDirectory, "index.html"), "utf8");
  assert.match(output, /<link rel="canonical" href="https:\/\/ingles\.example\.com\/\?from=share&amp;lang=pt">/);
  assert.match(output, /<meta property="og:url" content="https:\/\/ingles\.example\.com\/\?from=share&amp;lang=pt">/);
  assert.match(output, /<meta property="og:image" content="https:\/\/ingles\.example\.com\/assets\/ebook-dispositivos\.webp">/);
  assert.equal((output.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((output.match(/property="og:url"/g) || []).length, 1);
  assert.equal(await readFile(join(paths.sourceDirectory, "index.html"), "utf8"), sourceHtml);
  assert.equal(await readFile(join(paths.sourceDirectory, "config.js"), "utf8"), paths.configSource);
});

test("URLs inválidas não substituem a última saída válida", async (t) => {
  const paths = await fixture(t);
  await buildSite(paths);
  for (const siteUrl of ["http://example.com", "javascript:alert(1)", "https://user:password@example.com", "invalid", 42]) {
    await writeFile(join(paths.sourceDirectory, "config.js"), `window.SITE_CONFIG = ${JSON.stringify({ siteUrl })};`);
    await assert.rejects(buildSite(paths), /siteUrl/);
    assert.equal(await readFile(join(paths.outputDirectory, "index.html"), "utf8"), sourceHtml);
  }
});

test("a configuração é avaliada sem expor process do Node", async (t) => {
  const paths = await fixture(t);
  await writeFile(join(paths.sourceDirectory, "config.js"), 'window.SITE_CONFIG = { siteUrl: typeof process === "undefined" ? "" : "process-exposed" };');
  await buildSite(paths);
  assert.equal(await readFile(join(paths.outputDirectory, "index.html"), "utf8"), sourceHtml);
});
