/**
 * ХВОСТ ТРАНСКРИПТА — одно правило чтения для всех Stop-гейтов.
 *
 * ЗАМЕР, РАДИ КОТОРОГО ЭТО НАПИСАНО (2026-08-31). Семь Stop-гейтов читали
 * транскрипт сессии ЦЕЛИКОМ (`readFileSync(transcriptPath)`). На живой
 * сессии в 158 МБ каждый гейт стоил 0.7–0.9 с, пачка — 5.2 с на КАЖДОЕ
 * завершение хода; из 1626 запусков за неделю 1293 упёрлись в таймаут (80%).
 * Стоимость чтения: 8 гейтов × 158 МБ ≈ 1.2 ГБ на один стоп.
 *
 * ПОЧЕМУ ХВОСТА ДОСТАТОЧНО. Решения гейтов живут в ПОСЛЕДНИХ ходах: правил
 * ли этот ход UI, звался ли браузер, есть ли непокрытый документ-синтез.
 * 8 МБ хвоста — это десятки последних ходов с запасом; история первого дня
 * сессии на вердикт не влияет. Гейты fail-open и блокируют не больше раза
 * за сессию — недочитанная древность в худшем случае значит «не заблокировал»,
 * то есть ровно то, что и так происходило при таймауте, только без 5 секунд.
 *
 * Обрезка идёт ДО ПЕРВОЙ ПОЛНОЙ СТРОКИ: транскрипт — JSONL, и оборванная
 * первая строка иначе давала бы мусор в JSON.parse у каждого потребителя.
 *
 * @closes-class stop-hooks-read-the-whole-transcript
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
// Тот же файл, что ./load-cli.mjs; путь записан через lib/, как у гейтов, чтобы сторож
// cli-strictness узнал загрузчик строгого разбора (он ищет «lib/load-cli.mjs»).
import { loadCli } from "./load-cli.mjs";

export const ХВОСТ_ПО_УМОЛЧАНИЮ = 8 * 1024 * 1024;

/** Последние `максБайт` файла, начиная с первой полной строки. */
export function хвостТранскрипта(путь, максБайт = ХВОСТ_ПО_УМОЛЧАНИЮ) {
    const размер = fs.statSync(путь).size;
    if (размер <= максБайт) return fs.readFileSync(путь, "utf8");
    const fd = fs.openSync(путь, "r");
    try {
        const буфер = Buffer.alloc(максБайт);
        fs.readSync(fd, буфер, 0, максБайт, размер - максБайт);
        const текст = буфер.toString("utf8");
        const перенос = текст.indexOf("\n");
        return перенос >= 0 ? текст.slice(перенос + 1) : текст;
    } finally {
        fs.closeSync(fd);
    }
}

// Строгий разбор аргументов (2026-09-16): модуль — библиотека гейтов, как программа он умеет
// только самопроверку. Незнакомый флаг или лишнее слово — отказ с кодом 2 до всякой работы.
// Это не хук Claude Code (settings.json его не зовёт), поэтому код отказа обычный, 2.
/**
 * Чистая: индекс, с которого начинается последний ход агента, — строка после последней РЕПЛИКИ
 * человека. Результаты инструментов Claude Code пишет строками с ролью user; считать такую строку
 * репликой значит видеть ноль вызовов в любом ходе с инструментами. Так closing-summary-gate
 * молчал на живых сессиях (найдено 2026-09-16, кейс eval closing-summary-gate/red-work-without-summary).
 * @param {Array<object>} строки разобранные строки транскрипта
 * @returns {number}
 */
export function началоХода(строки) {
    for (let i = строки.length - 1; i >= 0; i--) {
        const m = строки[i] && строки[i].message;
        if (!m || m.role !== "user") continue;
        const c = m.content;
        const реплика = typeof c === "string" || (Array.isArray(c) && c.some((p) => p && p.type !== "tool_result"));
        if (реплика) return i + 1;
    }
    return 0;
}

export const CLI = {
    name: "transcript-tail",
    path: "hooks/lib/transcript-tail.mjs",
    summary: "Хвост транскрипта для Stop-гейтов: библиотека; как программа — только самопроверка.",
    selfTest: true,
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
    const { selfTest: wantsSelfTest } = (await loadCli(import.meta.url)).runCli(CLI);
    if (wantsSelfTest) {
        // Самопроверка без внешних файлов: пишем временный JSONL и режем его.
        const os = await import("node:os");
        const path = await import("node:path");
        const tmp = path.join(os.tmpdir(), `tail-test-${process.pid}.jsonl`);
        const строки = Array.from({ length: 1000 }, (_, i) => JSON.stringify({ i }));
        fs.writeFileSync(tmp, строки.join("\n") + "\n");
        let ok = 0, fail = 0;
        const проверь = (имя, факт) => (факт ? ok++ : (fail++, console.error("FAIL:", имя)));

        // 1. Маленький файл читается целиком.
        проверь("маленький целиком", хвостТранскрипта(tmp, 1024 * 1024).split("\n").filter(Boolean).length === 1000);
        // 2. Обрезка начинается с ПОЛНОЙ строки — каждая строка парсится.
        const хвост = хвостТранскрипта(tmp, 300);
        проверь("хвост непуст", хвост.length > 0 && хвост.length <= 300);
        проверь(
            "каждая строка хвоста — валидный JSON",
            хвост.split("\n").filter(Boolean).every((l) => {
                try { JSON.parse(l); return true; } catch { return false; }
            }),
        );
        // 3. Хвост оканчивается ПОСЛЕДНЕЙ строкой файла.
        const последняя = хвост.split("\n").filter(Boolean).at(-1);
        проверь("последняя строка на месте", JSON.parse(последняя).i === 999);
        // 4. КЕЙС РАСХОЖДЕНИЯ, принятый осознанно: строка старше хвоста ЧИТАТЕЛЮ
        //    НЕ ВИДНА. Гейт, смотрящий в хвост, скажет «чисто» о нарушении из
        //    древнего хода. Принято: гейты block-once и fail-open, древность и
        //    раньше терялась — в таймауте, только с пятисекундной платой.
        const первая = хвост.split("\n").filter(Boolean)[0];
        проверь("древность отрезана (кейс расхождения)", JSON.parse(первая).i > 0);
        fs.unlinkSync(tmp);
        // 5. Начало хода — после реплики человека, а не после результата инструмента.
        const ход = [
            { message: { role: "user", content: "почини тест" } },
            { message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } },
            { message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "..." }] } },
            { message: { role: "assistant", content: [{ type: "text", text: "Готово" }] } },
        ];
        проверь("результат инструмента не начинает ход", началоХода(ход) === 1);
        проверь("реплика строкой начинает ход", началоХода([...ход, { message: { role: "user", content: "ещё" } }]) === 5);
        проверь("реплика из текста и картинки начинает ход",
            началоХода([...ход, { message: { role: "user", content: [{ type: "text", text: "см." }, { type: "image" }] } }]) === 5);
        проверь("без реплик ход — весь хвост", началоХода([ход[1], ход[2]]) === 0);
        console.log(`self-test: ${ok} ok, ${fail} fail`);
        process.exit(fail ? 1 : 0);
    }
}
