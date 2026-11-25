import test from "node:test";
import assert from "node:assert/strict";
import { findSitePrompt, keywordMatches, promptMessages } from "../lib/site-prompts.js";

const MEDIA = "17900000000000002";
const LINK = "https://www.instagram.com/ahmetcerit.ai/reel/DgFhMq0sIbW/";
const item = {
  id: "DgFhMq0sIbW",
  title: "Animasyon rehberi",
  videoUrl: LINK,
  prompt: "UYARLANABİLİR ÖRNEK PROMPT\n\nBir sahne oluştur.",
  published: true,
};

function mockFetch(data) {
  return async (url) => String(url).includes("graph.instagram.com")
    ? Response.json({ permalink: LINK })
    : Response.json(data);
}

test("yalnızca yayındaki Reel'in etkin anahtar kelimesi eşleşirse prompt bulunur", async () => {
  const data = { items: [item], automationRules: [{ itemId: item.id, keyword: "video", enabled: true }] };
  const options = { accessToken: "TEST", commentText: "Video gönder!", fetchImpl: mockFetch(data) };
  const found = await findSitePrompt(MEDIA, options);
  assert.deepEqual(found, { id: item.id, title: item.title, prompt: "Bir sahne oluştur.", sample: true });
  assert.equal(await findSitePrompt(MEDIA, { ...options, commentText: "videolar güzel" }), null);
  assert.equal(await findSitePrompt(MEDIA, { ...options, commentText: "prompt" }), null);
  assert.equal(await findSitePrompt(MEDIA, { ...options, fetchImpl: mockFetch({ ...data, automationRules: [] }) }), null);
  assert.equal(await findSitePrompt(MEDIA, { ...options, fetchImpl: mockFetch({ ...data, items: [{ ...item, published: false }] }) }), null);
});

test("DM parçaları kopyalanabilir ve Instagram metin sınırına uygun", () => {
  const parts = promptMessages({ title: "Reel", prompt: "a".repeat(2100), sample: true });
  assert.equal(parts.length, 3);
  assert(parts.every((part) => part.length <= 900));
  assert.match(parts[0], /uyarlanabilir örnek prompt/);
  assert.equal(parts.join("").replace(/^Reel için kopyalanabilir uyarlanabilir örnek prompt:\n\n/, ""), "a".repeat(2100));
});

test("SKILL büyük harf ve Türkçe i farklı yazılsa da aynı Reel kuralına eşleşir", () => {
  assert(keywordMatches("SKILL lütfen", "skill"));
  assert(keywordMatches("skill", "SKILL"));
  assert(!keywordMatches("skills", "skill"));
});
