// scripts/main.js
"use strict";

/**
 * Инициализация модуля.
 * Регистрируем хелперы Handlebars.
 */
Hooks.once("init", function () {
    console.log("PF2E Character Master | Инициализация модуля");

    // Хелпер {{join array ", "}} — склеивает массив в строку
    Handlebars.registerHelper("join", function (items, separator) {
        if (!items || !Array.isArray(items)) return "";
        const sep = typeof separator === "string" ? separator : ", ";
        return items.join(sep);
    });
});

/**
 * Добавляем кнопку с шляпой в лист персонажа PF2e.
 */
Hooks.on("renderActorSheet", (app, html, data) => {
    // Работаем только с системой PF2e
    if (game.system.id !== "pf2e") return;
    // Только актёры-персонажи
    if (!app.actor || app.actor.type !== "character") return;

    // Если кнопка уже есть — не дублируем
    if (html.find(".pf2ecm-header-button").length > 0) return;

    // Ищем шапку листа
    let header = html.find(".char-header");
    if (!header.length) {
        header = html.find(".sheet-header");
    }
    if (!header.length) return;

    const title = game.i18n.localize("PF2ECM.controls.button");

    // Создаём кнопку
    const button = $(`
    <a class="pf2ecm-header-button" data-action="open-pf2e-character-master" title="${title}">
      <i class="fa-solid fa-hat-wizard"></i>
    </a>
  `);

    // Лёгкие инлайн-стили, чтобы не ломать оформление PF2e
    button.css({
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        "margin-left": "8px",
        "cursor": "pointer"
    });

    // Добавляем в шапку
    header.append(button);

    // Открытие мастера по клику
    button.on("click", (event) => {
        event.preventDefault();
        const cmApp = new PF2ECharacterMasterApp({ actor: app.actor });
        cmApp.render(true);
    });
});
