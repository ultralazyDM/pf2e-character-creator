"use strict";

/**
 * Шаг «Атрибуты» для PF2ECharacterMasterApp.
 *
 * Безопасная версия:
 * - Ничего не меняет в актёре
 * - Все выборы живут только в this.draft.abilities
 */

(function registerAbilitiesStep(appClass) {
    if (!appClass) return;

    // Добавляем шаг abilities после subclass (или в конец, если его нет)
    if (!appClass.STEP_IDS.includes("abilities")) {
        const idx = appClass.STEP_IDS.indexOf("subclass");
        if (idx >= 0) appClass.STEP_IDS.splice(idx + 1, 0, "abilities");
        else appClass.STEP_IDS.push("abilities");
    }

    const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

    function ensureDraft(draft) {
        if (!draft.abilities) draft.abilities = {};
        if (!draft.abilities.sources) {
            // Плоская структура, без вложенных объектов, чтобы было проще использовать в шаблоне
            draft.abilities.sources = {
                ancestry: {},
                background: {},
                class: {},
                free_lvl1: {},
                free_lvl5: {},
                free_lvl10: {},
                free_lvl15: {},
                free_lvl20: {}
            };
        }
    }

    const originalPrepare = appClass.prototype._prepareContext;

    appClass.prototype._prepareContext = async function () {
        const ctx = await originalPrepare.call(this);

        if (this.currentStepId !== "abilities") return ctx;

        ensureDraft(this.draft);

        ctx.abilities = {
            list: ABILITIES,
            sources: this.draft.abilities.sources,
            labels: {
                str: game.i18n.localize("PF2E.AbilityStr"),
                dex: game.i18n.localize("PF2E.AbilityDex"),
                con: game.i18n.localize("PF2E.AbilityCon"),
                int: game.i18n.localize("PF2E.AbilityInt"),
                wis: game.i18n.localize("PF2E.AbilityWis"),
                cha: game.i18n.localize("PF2E.AbilityCha")
            }
        };

        return ctx;
    };

    // Клик по кнопке "повыш"
    appClass.prototype._onToggleAbilityBoost = function (event, target) {
        event.preventDefault();

        const source = target.dataset.source;
        const ability = target.dataset.ability;
        if (!source || !ability) return;

        ensureDraft(this.draft);
        const sources = this.draft.abilities.sources;
        const src = sources[source];
        if (!src) return;

        src[ability] = !src[ability];

        this.render();
    };

    // Регистрируем action
    const opts = appClass.DEFAULT_OPTIONS;
    opts.actions ??= {};
    opts.actions.toggleAbilityBoost =
        appClass.prototype._onToggleAbilityBoost;

})(PF2ECharacterMasterApp);
