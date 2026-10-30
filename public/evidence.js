import { node, number, percent, detail, list, deviceName, time } from "./ui.js";
export function historyEventView(row) {
  const card = node("article", null, "change-event");
  card.append(
    node(
      "p",
      `Tespit aralığı: ${time(row.observed_from)} – ${time(row.observed_to)}. Gerçek yayın tarihi: ${row.published_at ? time(row.published_at) : "bilinmiyor"}.`,
    ),
  );
  const labels = {
    title: "Başlık",
    description: "Meta açıklaması",
    body_hash: "İçerik özeti (hash)",
    canonical: "Canonical URL",
    robots: "Dizin yönergeleri",
    status: "HTTP durumu",
    headings: "Başlık hiyerarşisi",
    links: "İç bağlantılar",
    structured_data: "Yapılandırılmış veriler",
    images: "Görseller",
    x_robots: "X-Robots-Tag",
    hreflang: "Dil alternatifleri",
    viewport: "Mobil görünüm",
    lang: "Sayfa dili",
  };
  for (const [field, values] of Object.entries(JSON.parse(row.diff_json))) {
    const entry = node("div", null, "change-values");
    entry.append(node("h3", labels[field] || "Sayfa öğesi"));
    for (const [key, label] of [
      ["old", "Eski"],
      ["new", "Yeni"],
    ]) {
      const text =
        typeof values[key] === "string"
          ? values[key]
          : JSON.stringify(values[key], null, 2);
      const box = node("div");
      box.append(node("strong", label), node("pre", text ?? "Kayıt yok"));
      entry.append(box);
    }
    card.append(entry);
  }
  return card;
}
export function evidenceView(p, report) {
  return detail(
    "Kanıt, hesaplama ve eksikler",
    node(
      "p",
      `Dönem: ${report.period.start} – ${report.period.end}. Karşılaştırma: ${report.previous_period.start} – ${report.previous_period.end}. Ölçüm: ${report.created_at}.`,
    ),
    node(
      "p",
      `Kanıt güveni: ${p.confidence}. Sayfa eşlemesi canlı taramada doğrulandı: ${p.url_verified ? "Evet" : "Hayır"}.`,
    ),
    node("p", p.risk),
    node(
      "p",
      p.current && p.previous
        ? `Tıklama farkı: ${number(p.current.clicks - p.previous.clicks)}. Gösterim farkı: ${number(p.current.impressions - p.previous.impressions)}. CTR: toplam tıklama / toplam gösterim. Ortalama konum, gösterimlerle ağırlıklandırılır.`
        : "Hesaplama için iki dönemin de doğrulanmış ölçümleri gerekli.",
    ),
    list(
      p.missing.length
        ? p.missing
        : [
            "Gerekli günlük kapsam mevcut. Mevsimsellik ve nedensellik ayrıca incelenmelidir.",
          ],
    ),
    node(
      "p",
      p.evidence.length
        ? `Kaynak: Search Console. ${p.evidence.length} günlük veri kümesi. Filtre: bu ürünün kanonik sayfası, web araması; sorgu, ülke ve cihaz ayrı boyutlardır. Sorgular anonimleştirme nedeniyle eksik olabilir.`
        : "Search Console kaynak kanıtı yok.",
    ),
    list(
      p.evidence
        .slice(-3)
        .map((e) => `Kaynak kaydı: ${e.ref}. Alınma zamanı: ${e.fetched_at}.`),
    ),
  );
}
export function performanceView(p) {
  const parts = [
    ...p.devices.map((d) =>
      node(
        "p",
        `${deviceName(d.device)} · ${d.decision}: ${number(d.current?.clicks)} tıklama (önceki: ${number(d.previous?.clicks)}). ${d.reason}`,
      ),
    ),
    node(
      "p",
      `Görünür marka sorgusu tıklamaları: ${number(p.brand.brand?.clicks)}; markasız: ${number(p.brand.non_brand?.clicks)}. ${p.brand.note}`,
    ),
    node("p", "Kelime koruma denetimi"),
    list(
      p.queries
        .slice(0, 20)
        .map(
          (q) =>
            `${q.query}: ${number(q.clicks)} tıklama; önceki ${number(q.previous_clicks)}.${q.protect ? " Koru: başlık/URL değişikliğinde zarar riski." : ""}${q.missing_current ? " Güncel sorgu kaydı eksik; sıfır sayılmadı." : ""}`,
        ),
    ),
    ...Object.entries(p.comparisons).map(([key, value]) =>
      node(
        "p",
        `${key === "year_over_year" ? "Geçen yılın aynı dönemi" : key.replace("_months", " aylık geçmiş")}: ${value.complete ? "doğrulanmış kapsam var" : "veri kapsamı eksik; karşılaştırma yapılmadı"}.`,
      ),
    ),
  ];
  return detail("Cihaz, sorgu ve dönem karşılaştırmaları", ...parts);
}
export function answerView(answer) {
  const parts = [
    node(
      "p",
      `Kaynak: ${answer.source}. Ölçüm: ${answer.measured_at}. Dönem: ${answer.period.start} – ${answer.period.end}.`,
    ),
    node(
      "p",
      `Sayfa: ${answer.url || "Bu soru için doğrulanmış sayfa ölçümü yok"}. Cihaz: ${deviceName(answer.device) || "Soru kapsamı"}.`,
    ),
    node(
      "p",
      `Tıklama: ${number(answer.current?.clicks)}; önceki dönem: ${number(answer.previous?.clicks)}.`,
    ),
    list(answer.missing || []),
    list(answer.limitations || []),
  ];
  if(answer.snapshot)parts.push(node('p','Doğrulanmış arşiv · son veri: '+time(answer.snapshot.source_updated_at)+' · analiz doğrulaması: '+time(answer.snapshot.validated_at)+'.'));
  if (answer.products)
    parts.push(
      list(
        answer.products.map(
          (p) =>
            `${p.name} · ${p.url || "URL doğrulanmadı"}: ${number(p.current?.clicks)} tıklama; önceki ${number(p.previous?.clicks)}. ${
              (p.queries || [])
                .filter((q) => q.protect)
                .map((q) => q.query)
                .join(", ") || ""
            } ${p.risk || ""} ${(p.missing || []).join(" ")}`,
        ),
      ),
    );
  if (answer.items)
    parts.push(
      list(
        answer.items.map(
          (r) =>
            `${r.name} · ${r.url} · ${r.query}: ${number(r.current?.clicks)} tıklama, ${number(r.current?.impressions)} gösterim, CTR ${percent(r.current?.ctr)}, ortalama konum ${number(r.current?.position)}. ${r.risk}`,
        ),
      ),
    );
  if (answer.history)
    parts.push(
      list(
        answer.history.map(
          (r) =>
            `${r.url}: tespit ${r.observed_from} – ${r.observed_to}; yayın tarihi ${r.published_at || "bilinmiyor"}.`,
        ),
      ),
    );
  if (answer.outcomes)
    parts.push(
      list(
        answer.outcomes.map(
          (r) =>
            `${r.name} · ${r.url} · ${r.days} gün: ${r.status === "measured" ? "ölçüldü; nedensellik doğrulanamadı" : "veri bekleniyor"}.`,
        ),
      ),
    );
  if (answer.rows)
    parts.push(
      list(
        answer.rows.map(
          (r) =>
            `${r.city} / ${r.device}: ${number(r.sessions)} organik oturum.`,
        ),
      ),
    );
  return detail("Kaynak, tarih ve ölçüm", ...parts);
}
