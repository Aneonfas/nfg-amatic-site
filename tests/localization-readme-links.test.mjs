import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentPath = path.join(rootDir, "content", "home.locales.json");
const content = JSON.parse(await readFile(contentPath, "utf8"));
const generatorPath = path.join(rootDir, "scripts", "generate-localized-home.mjs");
const generatorSource = await readFile(generatorPath, "utf8");
const locales = ["en", "ru", "es", "de", "fr", "it", "pt-br", "zh-cn", "ja", "ko", "tr"];
const primaryLinks = [
  "https://anvil-planner.nfg-system.online/",
  "https://github.com/Aneonfas/anvil-empires-localizations/releases/download/ru-v1.1.0/Anvil-Empires-Russian-v1.1.0-steam-build-25584311.zip",
  "https://github.com/Aneonfas/anvil-empires-localizations/releases/download/es-v1.1.0-beta.2/Anvil-Empires-Spanish-v1.1.0-beta.2-steam-build-25584311.zip",
  "https://github.com/Aneonfas/anvil-empires-localizations/releases/download/tr-v1.0.0/Anvil-Empires-Turkish-v1.0.0-steam-build-25584311.zip",
  "https://github.com/Aneonfas/anvil-empires-localizations/releases/download/de-v1.0.0-beta.1/Anvil-Empires-German-v1.0.0-beta.1-steam-build-25584311.zip",
  "https://github.com/Aneonfas/nfg-hub/releases/download/v0.4.0/NFG-Hub-v0.4.0-win-x64.zip",
];
const documentationLinks = new Map([
  [1, { href: "https://github.com/Aneonfas/anvil-empires-localizations/blob/main/README.ru.md", language: "ru" }],
  [2, { href: "https://github.com/Aneonfas/anvil-empires-localizations/blob/main/README.es.md", language: "es" }],
  [3, { href: "https://github.com/Aneonfas/anvil-empires-localizations/blob/main/README.tr.md", language: "tr" }],
  [4, { href: "https://github.com/Aneonfas/anvil-empires-localizations/blob/main/README.de.md", language: "de" }],
]);
const newTabWording = {
  en: /new tab/i,
  ru: /новой вкладке/i,
  es: /(?:nueva pestaña|pestaña nueva)/i,
  de: /neuen Tab/i,
  fr: /nouvel onglet/i,
  it: /nuova scheda/i,
  "pt-br": /nova (?:aba|guia)/i,
  "zh-cn": /新(?:标签页|选项卡)/,
  ja: /新しいタブ/,
  ko: /새 탭/,
  tr: /yeni sekmede/i,
};

// Run the actual generator in --check mode. Only module plumbing and filesystem
// access are supplied by the harness; its validation/rendering code is unchanged.
const generatorScript = new vm.Script(`(async () => {
${generatorSource.replace(/^import[^\n]+\r?\n/gm, "").replaceAll("import.meta.url", "generatorUrl")}
})()`, { filename: generatorPath });

test("README link coverage includes every published locale and localized accessible copy", () => {
  assert.deepEqual(Object.keys(content.locales).sort(), [...locales].sort());
  for (const locale of locales) {
    const copy = content.locales[locale];
    for (const field of ["documentationAction", "documentationAria"]) {
      assert.ok(Object.hasOwn(copy, field), `${locale} must own ${field}, without a fallback`);
      assert.equal(typeof copy[field], "string", `${locale} ${field}`);
      assert.ok(copy[field].trim(), `${locale} ${field} must not be empty`);
    }
    assert.match(copy.documentationAria, /\{project\}/, `${locale} must identify the linked project`);
    assert.match(copy.documentationAria, newTabWording[locale], `${locale} must announce the new tab in its own language`);
    if (locale !== "en") {
      assert.notEqual(copy.documentationAria, content.locales.en.documentationAria, `${locale} must not reuse the English accessible label`);
    }
  }
});

for (const locale of locales) {
  test(`${locale}: exactly four secondary README links preserve all primary downloads and JSON-LD`, async () => {
    const copy = content.locales[locale];
    const html = await readFile(path.join(rootDir, locale, "index.html"), "utf8");
    const cards = [...html.matchAll(/<article class="project-row project-row-active">([\s\S]*?)<\/article>/g)].map((match) => match[1]);
    assert.equal(cards.length, primaryLinks.length, "All six project cards must remain");
    const secondaryLinks = anchors(html).filter((anchor) => classes(anchor).includes("project-link-secondary"));
    assert.equal(secondaryLinks.length, 4, "Only the Russian, Spanish, Turkish and German cards receive README links");
    assert.deepEqual(secondaryLinks.map((anchor) => anchor.attributes.href), [...documentationLinks.values()].map((link) => link.href));

    cards.forEach((card, index) => {
      const project = copy.projects[index];
      const links = anchors(card);
      const documentation = documentationLinks.get(index);
      assert.equal(links.length, documentation ? 2 : 1, `${project.title}: unexpected project link count`);
      const primary = links[0];
      assert.equal(primary.attributes.href, primaryLinks[index], `${project.title}: the first action must retain its original destination`);
      assert.ok(classes(primary).includes("project-link"));
      assert.ok(!classes(primary).includes("project-link-secondary"), "The original action must remain primary");
      assert.equal(primary.attributes["aria-label"], escapeAttr(project.aria));
      assert.ok(primary.body.includes(`<span>${escapeHtml(project.action)}</span>`));
      assertExternalLink(primary);

      if (!documentation) {
        assert.doesNotMatch(card, /project-link-secondary|\/blob\/main\/README\.(?:ru|es|tr|de)\.md/);
        return;
      }

      const group = card.match(/<div\b[^>]*\bclass="project-actions"[^>]*>([\s\S]*?)<\/div>/);
      assert.ok(group, `${project.title}: both actions must share the project-actions container`);
      assert.deepEqual(anchors(group[1]).map((anchor) => anchor.attributes.href), [primaryLinks[index], documentation.href]);
      const readme = links[1];
      assert.deepEqual(classes(readme), ["project-link", "project-link-secondary"]);
      assert.equal(readme.attributes.href, documentation.href);
      assert.equal(readme.attributes.hreflang, documentation.language, "hreflang describes the README language, not the current page");
      assert.equal(readme.attributes["aria-label"], escapeAttr(copy.documentationAria.replaceAll("{project}", project.title)));
      assert.doesNotMatch(readme.attributes["aria-label"], /\{project\}/);
      assert.notEqual(readme.attributes["aria-label"], primary.attributes["aria-label"]);
      assert.ok(readme.body.includes(`<span>${escapeHtml(copy.documentationAction)}</span>`), "The secondary action must use its localized visible label");
      assert.doesNotMatch(readme.rawAttributes, /\bdownload(?:\s|=|$)/, "README is navigation, not an archive download");
      assertExternalLink(readme);
    });

    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLd, `${locale}: JSON-LD must remain present`);
    const collection = JSON.parse(jsonLd[1])["@graph"].find((entry) => entry["@type"] === "CollectionPage");
    assert.ok(collection, `${locale}: CollectionPage must remain present`);
    assert.deepEqual(collection.mainEntity.itemListElement.map((entry) => entry.url), primaryLinks, "Documentation links must not replace product/download URLs in JSON-LD");
  });
}

test("the real generator accepts complete documentation copy without writing files", async () => {
  const run = runGenerator(content);
  await run.completion;
  assert.deepEqual(run.io, { sourceReads: 1, outputReads: locales.length + 3, writes: 0 });
});

for (const field of ["documentationAction", "documentationAria"]) {
  for (const [kind, value] of [["missing", undefined], ["empty", ""], ["whitespace-only", " \t\n "], ["non-string", null]]) {
    test(`the real generator rejects ${kind} ${field} in every locale before output access`, async () => {
      for (const locale of locales) {
        const invalid = structuredClone(content);
        if (value === undefined) delete invalid.locales[locale][field];
        else invalid.locales[locale][field] = value;
        const run = runGenerator(invalid);
        await assert.rejects(run.completion, new RegExp(field), `${locale}: ${kind} ${field} must be rejected`);
        assert.deepEqual(run.io, { sourceReads: 1, outputReads: 0, writes: 0 }, `${locale}: invalid copy must fail before checking or writing generated files`);
      }
    });
  }
}

test("the real generator rejects documentationAria without the project placeholder in every locale", async () => {
  for (const locale of locales) {
    const invalid = structuredClone(content);
    invalid.locales[locale].documentationAria = "README";
    const run = runGenerator(invalid);
    await assert.rejects(run.completion, /documentationAria.*\{project\}/, `${locale}: the accessible label must identify its project`);
    assert.deepEqual(run.io, { sourceReads: 1, outputReads: 0, writes: 0 });
  }
});

function runGenerator(input) {
  const io = { sourceReads: 0, outputReads: 0, writes: 0 };
  const rejectWrite = async () => {
    io.writes += 1;
    throw new Error("README validation must never write files");
  };
  const context = vm.createContext({
    path,
    fileURLToPath,
    generatorUrl: pathToFileURL(generatorPath).href,
    process: { argv: ["node", generatorPath, "--check"] },
    console: { log() {} },
    mkdir: rejectWrite,
    writeFile: rejectWrite,
    readFile: async (filename, encoding) => {
      if (path.resolve(filename) === contentPath) {
        io.sourceReads += 1;
        return JSON.stringify(input);
      }
      assert.ok(path.resolve(filename).startsWith(`${rootDir}${path.sep}`), "Generator output checks must stay inside the project");
      io.outputReads += 1;
      return readFile(filename, encoding);
    },
  });
  return { completion: generatorScript.runInContext(context, { timeout: 5_000 }), io };
}

function anchors(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    rawAttributes: match[1],
    attributes: Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], attribute[2]])),
    body: match[2],
  }));
}

function classes(anchor) {
  return (anchor.attributes.class ?? "").split(/\s+/).filter(Boolean);
}

function assertExternalLink(anchor) {
  assert.equal(anchor.attributes.target, "_blank");
  assert.ok((anchor.attributes.rel ?? "").split(/\s+/).includes("noreferrer"));
  assert.ok(anchor.attributes["aria-label"]?.trim(), "External links must have a meaningful accessible name");
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
