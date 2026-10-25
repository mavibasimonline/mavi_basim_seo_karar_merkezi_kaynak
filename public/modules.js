import { scopeParams } from "./period.js";
import { $, node, number, percent, detail, list, sourceName } from "./ui.js";
export function setupModules(api, notify) {
  let auditRequest = 0,
    calendarRequest = 0,
    radarRequest = 0;
  async function loadRadar() {
    const request = ++radarRequest,
      scope = scopeParams().toString();
    try {
      const r = await api("/api/radar?" + scope);
      if (request !== radarRequest) return;
      const root = $("radarResults");
      root.replaceChildren();
      for (const [title, items] of [
        ["En yüksek öncelikli 5 SEO fırsatı", r.opportunities],
        ["Dikkat gerektiren 5 ürün", r.attention],
        ["Yükselen ürünler", r.rising],
        ["Gerileyen ürünler", r.declining],
        ["Veri yetersizliği nedeniyle izlenenler", r.insufficient],
      ]) {
        const section = node("section");
        section.append(node("h3", title));
        if (!items.length)
          section.append(node("p", "Yeterli kanıtla belirlenen ürün yok."));
        for (const item of items) {
          section.append(
            detail(
              `${item.name} · Kanıtları Gör`,
              node(
                "p",
                `${item.url || "URL doğrulanmadı"} · ${item.status} · Öncelik ${number(item.score)}`,
              ),
              node("p", item.risk),
              list(item.missing),
              list(item.flags),
              list(
                item.components.map(
                  (c) => `${c.name}: ${c.points}. ${c.calculation}`,
                ),
              ),
              list(
                item.market_demand.map(
                  (m) =>
                    `Keyword Planner · ${m.keyword}: ${number(m.avg_monthly_searches)}; ${m.path}, satır ${m.row_number}, ${m.exported_at}. Hacimler toplanmadı.`,
                ),
              ),
              list(
                item.evidence
                  .slice(-2)
                  .map((e) => `GSC: ${e.ref}; ${e.fetched_at}`),
              ),
            ),
          );
        }
        root.append(section);
      }
      root.append(
        detail(
          "Analiz kapsamı ve sınırlar",
          node(
            "p",
            `GSC · ${r.period.start} – ${r.period.end}; önceki ${r.comparison_period.start} – ${r.comparison_period.end}. Ölçüm: ${r.measured_at}`,
          ),
          list(r.limitations),
        ),
      );
    } catch (e) {
      if (request === radarRequest) $("radarResults").textContent = e.message;
    }
  }
  $("changeDay").value = new Date().toISOString().slice(0, 10);
  $("showChanges").addEventListener("click", async () => {
    const request = ++calendarRequest,
      day = $("changeDay").value;
    if (!$("changeDay").reportValidity()) return;
    try {
      const r = await api(
        "/api/change-calendar?day=" + encodeURIComponent($("changeDay").value),
      );
      const root = $("changeResults");
      if (request !== calendarRequest || day !== $("changeDay").value) return;
      root.replaceChildren();
      if (!r.rows.length)
        root.append(
          node("p", "Bu tarihte doğrulanmış değişiklik tespiti yok."),
        );
      for (const e of r.rows) {
        const card = node("article");
        const button = node("button", "Etkiyi İncele", "button secondary");
        card.append(
          node(
            "p",
            `${e.name || "Ürün eşlemesi eksik"} · ${e.url} · Tespit: ${e.observed_from} – ${e.observed_to}. Yayın: ${e.published_at || "bilinmiyor"}`,
          ),
          button,
        );
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const effect = await api(
              "/api/change-impact?id=" + encodeURIComponent(e.id),
            );
            card.append(
              detail(
                "Kanıtları Gör",
                node("p", `${effect.status}. ${effect.causality}`),
                node(
                  "p",
                  `Önce: ${effect.ranges.before.start} – ${effect.ranges.before.end}; sonra: ${effect.ranges.after.start} – ${effect.ranges.after.end}. GSC: ${effect.measured_at}`,
                ),
                node("p", effect.rollback.suggestion),
                list(effect.missing),
                list(
                  Object.entries(effect.old_new).map(
                    ([key, value]) =>
                      `${key}: ${JSON.stringify(value.old)} → ${JSON.stringify(value.new)}`,
                  ),
                ),
                node(
                  "p",
                  `Tıklama: ${number(effect.previous?.clicks)} → ${number(effect.current?.clicks)}. Gösterim: ${number(effect.previous?.impressions)} → ${number(effect.current?.impressions)}. Ortalama konum: ${number(effect.previous?.position)} → ${number(effect.current?.position)}.`,
                ),
                list(
                  effect.queries.map(
                    (q) =>
                      `${q.query}: ${number(q.previous_clicks)} → ${number(q.clicks)} tıklama.${q.protect ? " Önceki başarı korunmalı." : ""}`,
                  ),
                ),
                list(effect.limitations),
              ),
            );
          } catch (error) {
            card.append(node("p", error.message));
          } finally {
            button.disabled = false;
          }
        });
        root.append(card);
      }
      root.append(detail("Tespit ve yayın tarihi", node("p", r.note)));
    } catch (e) {
      if (request === calendarRequest)
        $("changeResults").textContent = e.message;
    }
  });

  async function loadDataAudit() {
    const request = ++auditRequest,
      month = scopeParams().toString();
    try {
      const r = await api("/api/data-integrity?" + scopeParams().toString());
      const root = $("dataAuditResults");
      if (request !== auditRequest || month !== scopeParams().toString())
        return;
      root.replaceChildren(
        node("h3", "Kaynak Kontrolleri"),
        list(
          r.source_states.map(
            (s) =>
              `${sourceName(s.source)}/${sourceName(s.scope)}: ${s.status}; kayıt ${number(s.records)}, eksik gün ${s.missing_days.length}, son başarılı veri ${s.last_success || "yok"}.`,
          ),
        ),
        node(
          "p",
          `Keyword Planner: ${r.archive.status}; ${r.archive.files} dosya, ${r.archive.records} kaynak satırı. ${r.archive.note}`,
        ),
        node("h3", "Hatalı veya Eksik Kayıtlar"),
        list(
          r.issues.map(
            (i) =>
              `${i.source} · ${i.record} · ${i.field}: ${i.code}; beklenen ${JSON.stringify(i.expected)}, gerçek ${JSON.stringify(i.actual)}`,
          ),
        ),
        node("h3", "Metrik Doğrulama"),
        list(
          r.metric_errors.length
            ? r.metric_errors
            : [
                "Mevcut ölçümler için bağımsız SQL kontrolünde hesap hatası bulunmadı; eksik veri bu sonuçla tamamlanmış sayılmaz.",
              ],
        ),
        node("h3", "Ürün Bazlı Güvenilirlik"),
        list(
          r.products.map(
            (p) =>
              `${p.name} · ${p.url || "URL eşlemesi yok"}: ${p.state}. ${p.missing.join(" ")} ${p.query_difference_explanation || ""}`,
          ),
        ),
        detail(
          "Denetim kapsamı ve sınırlar",
          node(
            "p",
            `Denetim: ${r.measured_at}; ${r.period.start} – ${r.period.end}.`,
          ),
          list(r.limitations),
        ),
      );
      const history = await api("/api/audit-history");
      if (request !== auditRequest || month !== scopeParams().toString())
        return;
      root.append(
        detail(
          "Denetim Geçmişi",
          list(
            history.rows.map(
              (h) => `${sourceName(h.kind)} · ${h.created_at} · ${h.id}`,
            ),
          ),
        ),
      );
    } catch (e) {
      if (request === auditRequest)
        $("dataAuditResults").textContent = e.message;
    }
  }

  $("runDataAudit").addEventListener("click", loadDataAudit);
  return {
    invalidate: () => {
      auditRequest++;
      calendarRequest++;
      radarRequest++;
    },
    radar: loadRadar,
    health: loadDataAudit,
    changes: () => {
      $("showChanges").click();
    },
  };
}
