import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const escapeAttribute = (value) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

export async function buildSite({
  sourceDirectory = join(projectDirectory, "public"),
  outputDirectory = join(projectDirectory, "dist"),
} = {}) {
  // Read the same public configuration used by the browser, without exposing
  // Node's process, filesystem or imports to the configuration's VM context.
  const context = vm.createContext(
    { window: Object.create(null) },
    {
      codeGeneration: { strings: false, wasm: false },
    },
  );
  vm.runInContext(
    await readFile(join(sourceDirectory, "config.js"), "utf8"),
    context,
    {
      timeout: 100,
      filename: "config.js",
    },
  );
  const config = JSON.parse(
    vm.runInContext("JSON.stringify(window.SITE_CONFIG || {})", context, {
      timeout: 100,
    }),
  );
  let html = await readFile(join(sourceDirectory, "index.html"), "utf8");
  const configuredUrl = config.siteUrl ?? "";
  if (typeof configuredUrl !== "string")
    throw new Error("siteUrl precisa ser uma string HTTPS ou ficar vazia.");

  if (configuredUrl.trim()) {
    let siteUrl;
    try {
      siteUrl = new URL(configuredUrl);
      if (siteUrl.protocol !== "https:" || siteUrl.username || siteUrl.password)
        throw new Error();
    } catch {
      throw new Error(
        "siteUrl precisa ser uma URL HTTPS válida, sem credenciais.",
      );
    }
    siteUrl.hash = "";
    const absoluteImage = escapeAttribute(
      new URL("/assets/ebook-dispositivos.webp", siteUrl).href,
    );
    const absoluteUrl = escapeAttribute(siteUrl.href);
    const imageTag = /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?\s*>/i;
    if (!imageTag.test(html))
      throw new Error(
        "A tag og:image não foi encontrada em public/index.html.",
      );
    html = html.replace(
      imageTag,
      () => `<meta property="og:image" content="${absoluteImage}">`,
    );
    // Avoid duplicates if explicit metadata is added to the source later.
    html = html.replace(/<link\b[^>]*\brel="canonical"[^>]*>/gi, "");
    html = html.replace(/<meta\b[^>]*\bproperty="og:url"[^>]*>/gi, "");
    html = html.replace(
      "</head>",
      `  <link rel="canonical" href="${absoluteUrl}">\n    <meta property="og:url" content="${absoluteUrl}">\n  </head>`,
    );
  }

  await rm(outputDirectory, { recursive: true, force: true });
  await cp(sourceDirectory, outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "index.html"), html);
  console.log(
    `Build concluído: ${outputDirectory}${configuredUrl.trim() ? " (Open Graph e canonical com URLs absolutas)" : " (prévia local; configure siteUrl antes de publicar)"}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await buildSite();
}
