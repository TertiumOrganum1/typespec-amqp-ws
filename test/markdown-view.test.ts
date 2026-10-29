import { describe, expect, test } from "vitest";
import { toMarkdownView } from "../src/shared/markdown-view.js";
import { amqpDoc, wsDoc } from "./utils/view-docs.js";

describe("toMarkdownView", () => {
  test("заголовок, витрина и оглавление со ссылками на операции и модели", () => {
    const md = toMarkdownView(amqpDoc());
    expect(md.startsWith("# Reports 1.2.3\n\nСервис отчётов.\n\n**Витрина AsyncAPI-документа.**")).toBe(true);
    expect(md).toContain("Транспорт: **AMQP**");
    expect(md).toContain("Документация: [https://example.com/docs](https://example.com/docs)");
    expect(md).toContain(
      [
        "## Содержание",
        "",
        "- [Принимает](#принимает)",
        "  - [consumeRender](#consumerender) — `render.request` — принять команду рендеринга",
        "- [Публикует](#публикует)",
        "  - [sendPdf](#sendpdf) — `pdf.{uid}` — готовый PDF",
        "- [Модели](#модели) — 3",
      ].join("\n"),
    );
    // receive раньше send
    expect(md.indexOf("### consumeRender")).toBeLessThan(md.indexOf("### sendPdf"));
  });

  test("операция: таблица транспорта и поля сообщения развёрнуты", () => {
    const md = toMarkdownView(amqpDoc());
    expect(md).toContain("**принимает** `render.request` — принять команду рендеринга");
    expect(md).toContain("| Очередь | `render-queue` |");
    expect(md).toContain("| Сообщение | [RenderCommand](#rendercommand) |");
    expect(md).toContain("**Сообщение** [RenderCommand](#rendercommand) · `application/json`");
    expect(md).toContain("| `uid` | `string | null` |  |  |".replace("string | null", "string \\| null"));
    expect(md).toContain('| `kind` | `string` | да | константа `"pdf"` |');
  });

  test("скалярный payload: тип модели и базовый тип, параметры routing key", () => {
    const md = toMarkdownView(amqpDoc());
    expect(md).toContain("Тип: [PdfResult](#pdfresult) — `string (binary)`");
    expect(md).toContain("| `uid` | Routing key parameter: uid. |");
  });

  test("модели: сводная таблица, обратные ссылки на операции, ограничения", () => {
    const md = toMarkdownView(amqpDoc());
    expect(md).toContain("| [RenderCommand](#rendercommand) |  |");
    expect(md).toContain("### RenderCommand\n\nСообщение операций: [consumeRender](#consumerender)");
    expect(md).toContain("| `a` | `integer` |  | по умолчанию `1` |");
  });

  test("WS: reply, бинарное сообщение без повторов текста", () => {
    const md = toMarkdownView(wsDoc());
    expect(md).toContain("**Ответ** [EchoReply](#echoreply) · `application/json`");
    expect(md).toContain("**Сообщение** `Upload` · `application/octet-stream`");
    expect(md).toContain("Без схемы: бинарный фрейм, формат — в описании.");
    // summary сообщения уже показан у операции — второй раз не выводится.
    expect(md.match(/загрузить блоб/g)).toHaveLength(2); // оглавление + заголовок операции
  });

  test("совпадение якорей нумеруется как в GitLab", () => {
    const doc = wsDoc();
    doc.operations!.Ping = doc.operations!.ping!;
    delete doc.operations!.ping;
    const md = toMarkdownView(doc);
    expect(md).toContain("[Ping](#ping) —");
    expect(md).toContain("[Ping](#ping-1)");
  });

  test("угловые скобки в описаниях экранируются", () => {
    const doc = amqpDoc();
    doc.components!.schemas!.RenderCommand!.description = "Модели <Template>_Data.";
    expect(toMarkdownView(doc)).toContain("Модели &lt;Template&gt;_Data.");
  });
});
