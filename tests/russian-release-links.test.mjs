import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = JSON.parse(
  await readFile(path.join(rootDir, "content", "home.locales.json"), "utf8"),
);
const locales = ["en", "ru", "es", "de", "fr", "it", "pt-br", "zh-cn", "ja", "ko", "tr"];
const russianVersion = "1.0.2";
const russianDownload =
  "https://github.com/Aneonfas/anvil-empires-localizations/releases/download/ru-v1.0.2/Anvil-Empires-Russian-v1.0.2-steam-build-24805551.zip";
const oldRussianRepository = /https:\/\/github\.com\/(?:nullith2|Aneonfas)\/anvil-empires-russian(?:\/|\b)/i;
const spanishVersion = "1.0.0";
const spanishBuild = "24805551";
const spanishDownload =
  "https://github.com/Aneonfas/anvil-empires-localizations/releases/download/es-v1.0.0/Anvil-Empires-Spanish-v1.0.0-steam-build-24805551.zip";
const lastTestedWording = {
  en: /last tested/i,
  ru: /последняя проверка/i,
  es: /última prueba/i,
  de: /zuletzt.*getestet/i,
  fr: /dernier test/i,
  it: /ultimo test/i,
  "pt-br": /último teste/i,
  "zh-cn": /上次测试/,
  ja: /最終動作確認/,
  ko: /마지막 테스트/,
  tr: /son test/i,
};
const exclusiveBuildWording =
  /\bonly\b|только|\bsolo\b|\bnur\b|\buniquement\b|\bapenas\b|仅适用|専用|전용|yalnızca/i;
const nextTestDateWording = {
  en: /next test date remains in English/,
  ru: /Дата следующего теста остаётся на английском/,
  es: /fecha de la próxima prueba sigue en inglés/,
  de: /Datum des nächsten Tests bleibt auf Englisch/,
  fr: /date du prochain test reste en anglais/,
  it: /data del prossimo test resta in inglese/i,
  "pt-br": /data do próximo teste continua em inglês/,
  "zh-cn": /下次测试的日期仍以英语显示/,
  ja: /次回テストの日時は英語表示のまま/,
  ko: /다음 테스트 날짜는 영어로 표시됩니다/,
  tr: /Sonraki testin tarihi İngilizce kalır/,
};
const betaWording = /\bbeta\b|\bbêta\b|бета|ベータ|베타/i;

test("Russian release checks cover every published locale", () => {
  assert.deepEqual(Object.keys(content.locales).sort(), [...locales].sort());
});

test("Italian is discoverable from every homepage, the sitemap and language metadata", async () => {
  const italianUrl = "https://nfg-system.online/it/";
  for (const locale of locales) {
    const html = await readFile(path.join(rootDir, locale, "index.html"), "utf8");
    assert.ok(html.includes(`<link rel="alternate" hreflang="it" href="${italianUrl}" />`));
    assert.match(html, /<a href="\/it\/" data-locale-choice="it" lang="it" hreflang="it"(?: aria-current="page")?>Italiano<\/a>/);
    if (locale === "it") {
      assert.match(html, /<html lang="it">/);
      assert.ok(html.includes(`<link rel="canonical" href="${italianUrl}" />`));
      assert.match(html, /<meta property="og:locale" content="it_IT"/);
      const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];
      assert.equal(graph.find((entry) => entry["@type"] === "CollectionPage").inLanguage, "it");
    }
  }
  const sitemap = await readFile(path.join(rootDir, "sitemap.xml"), "utf8");
  assert.equal((sitemap.match(/<url>/g) ?? []).length, locales.length);
  assert.ok(sitemap.includes(`<loc>${italianUrl}</loc>`));
  assert.ok((await readFile(path.join(rootDir, "llms.txt"), "utf8")).includes(italianUrl));
});

for (const locale of locales) {
  test(`${locale}: Russian CTA, accessible label and JSON-LD use the current release`, async () => {
    const project = content.locales[locale].projects[1];
    for (const field of ["action", "aria"]) {
      assert.deepEqual(
        project[field].match(/\d+\.\d+\.\d+/g),
        [russianVersion],
        `${locale} source ${field} must name Russian release ${russianVersion}`,
      );
    }

    const html = await readFile(path.join(rootDir, locale, "index.html"), "utf8");
    const articles = [...html.matchAll(
      /<article class="project-row project-row-active">([\s\S]*?)<\/article>/g,
    )];
    assert.equal(articles.length, 5, `${locale} must retain all five products`);
    const russianCard = articles[1][1];
    const anchor = russianCard.match(/<a\s+([\s\S]*?)>([\s\S]*?)<\/a>/);
    assert.ok(anchor, `${locale} Russian download link is missing`);
    assert.equal(anchor[1].match(/href="([^"]+)"/)?.[1], russianDownload);
    assert.equal(anchor[1].match(/aria-label="([^"]+)"/)?.[1], escapeAttr(project.aria));
    assert.ok(anchor[2].includes(`<span>${escapeHtml(project.action)}</span>`));
    assert.match(anchor[1], /target="_blank"/);
    assert.match(anchor[1], /rel="noreferrer"/);

    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLd, `${locale} JSON-LD is missing`);
    const graph = JSON.parse(jsonLd[1])["@graph"];
    const collection = graph.find((entry) => entry["@type"] === "CollectionPage");
    assert.equal(collection.mainEntity.itemListElement[1].url, russianDownload);
    assert.doesNotMatch(html, oldRussianRepository);
  });

  test(`${locale}: Spanish CTA, copy and JSON-LD name the stable release and last tested build`, async () => {
    const project = content.locales[locale].projects[2];
    for (const field of ["action", "aria"]) {
      assert.deepEqual(
        project[field].match(/\d+\.\d+\.\d+/g),
        [spanishVersion],
        `${locale} source ${field} must name Spanish release ${spanishVersion}`,
      );
      assert.doesNotMatch(project[field], betaWording);
    }
    assert.deepEqual(
      project.secondary.match(/\d+\.\d+\.\d+/g),
      [spanishVersion],
      `${locale} Spanish description must name its published release`,
    );
    assert.deepEqual(
      project.secondary.match(/\b\d{8}\b/g),
      [spanishBuild],
      `${locale} Spanish description must identify the last tested game build`,
    );
    assert.match(
      project.secondary,
      lastTestedWording[locale],
      `${locale} must present the build as testing history`,
    );
    assert.doesNotMatch(
      project.secondary,
      exclusiveBuildWording,
      `${locale} must not restrict installation to the tested build`,
    );
    assert.doesNotMatch(project.secondary, betaWording);
    assert.match(project.secondary, nextTestDateWording[locale]);

    const html = await readFile(path.join(rootDir, locale, "index.html"), "utf8");
    const articles = [...html.matchAll(
      /<article class="project-row project-row-active">([\s\S]*?)<\/article>/g,
    )];
    const spanishCard = articles[2][1];
    assert.ok(spanishCard.includes(
      `<p class="project-copy-secondary">${escapeHtml(project.secondary)}</p>`,
    ));
    const anchor = spanishCard.match(/<a\s+([\s\S]*?)>([\s\S]*?)<\/a>/);
    assert.ok(anchor, `${locale} Spanish download link is missing`);
    assert.equal(anchor[1].match(/href="([^"]+)"/)?.[1], spanishDownload);
    assert.equal(anchor[1].match(/aria-label="([^"]+)"/)?.[1], escapeAttr(project.aria));
    assert.ok(anchor[2].includes(`<span>${escapeHtml(project.action)}</span>`));
    assert.match(anchor[1], /target="_blank"/);
    assert.match(anchor[1], /rel="noreferrer"/);

    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const collection = JSON.parse(jsonLd[1])["@graph"].find(
      (entry) => entry["@type"] === "CollectionPage",
    );
    const spanishItem = collection.mainEntity.itemListElement[2];
    assert.equal(spanishItem.url, spanishDownload);
    assert.equal(spanishItem.description, project.secondary);
  });
}

test("llms.txt points to the same Russian release archive", async () => {
  const text = await readFile(path.join(rootDir, "llms.txt"), "utf8");
  const russianLines = text.split(/\r?\n/).filter(
    (line) => line.startsWith("- [Anvil Empires Russian localization]"),
  );
  assert.deepEqual(russianLines, [
    `- [Anvil Empires Russian localization](${russianDownload})`,
  ]);
  assert.doesNotMatch(text, oldRussianRepository);
});

test("llms.txt carries the same Spanish release and testing note as the English page", async () => {
  const text = await readFile(path.join(rootDir, "llms.txt"), "utf8");
  const spanishLines = text.split(/\r?\n/).filter(
    (line) => line.startsWith("- [Anvil Empires Spanish localization]") ||
      line.startsWith("- Spanish localization:"),
  );
  assert.deepEqual(spanishLines, [
    `- [Anvil Empires Spanish localization](${spanishDownload})`,
    `- Spanish localization: ${content.locales.en.projects[2].secondary}`,
  ]);
});

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
